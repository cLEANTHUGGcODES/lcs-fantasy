import { requireAuthUser } from "@/lib/draft-auth";
import { processDueDrafts } from "@/lib/draft-automation";
import { getDraftDetail } from "@/lib/draft-data";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { DraftStatus } from "@/types/draft";

type StatusBody = {
  status?: DraftStatus;
  force?: boolean;
};

const parseDraftId = (raw: string): number => {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error("Invalid draft id.");
  }
  return value;
};

const isValidTransition = (
  current: DraftStatus,
  next: DraftStatus,
): boolean => {
  if (current === next) {
    return true;
  }
  if (current === "scheduled" && (next === "live" || next === "completed")) {
    return true;
  }
  if (current === "live" && (next === "paused" || next === "completed")) {
    return true;
  }
  if (current === "paused" && (next === "live" || next === "completed")) {
    return true;
  }
  return false;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  try {
    const user = await requireAuthUser();
    const draftId = parseDraftId((await params).draftId);
    const body = (await request.json()) as StatusBody;
    const targetStatus = body.status;
    const force = body.force === true;

    if (
      targetStatus !== "scheduled" &&
      targetStatus !== "live" &&
      targetStatus !== "paused" &&
      targetStatus !== "completed"
    ) {
      return Response.json({ error: "Invalid status." }, { status: 400 });
    }

    await processDueDrafts({ draftId });

    const detail = await getDraftDetail({
      draftId,
      currentUserId: user.id,
    });

    if (!detail.isCommissioner) {
      return Response.json(
        { error: "Only the commissioner can update draft status." },
        { status: 403 },
      );
    }

    if (!isValidTransition(detail.status, targetStatus)) {
      return Response.json(
        {
          error: `Invalid status transition from ${detail.status} to ${targetStatus}.`,
        },
        { status: 400 },
      );
    }

    if (
      targetStatus === "live" &&
      detail.status !== "live" &&
      !force &&
      (!detail.allParticipantsPresent || !detail.allParticipantsReady)
    ) {
      return Response.json(
        {
          error:
            `Cannot start draft until all participants are present and ready. ` +
            `Present ${detail.presentParticipantCount}/${detail.participantCount}, ` +
            `Ready ${detail.readyParticipantCount}/${detail.participantCount}.`,
        },
        { status: 400 },
      );
    }

    const update: Record<string, unknown> = {
      status: targetStatus,
    };
    if (targetStatus === "live" && !detail.startedAt) {
      update.started_at = new Date().toISOString();
    }

    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("fantasy_drafts")
      .update(update)
      .eq("id", detail.id);

    if (error) {
      throw new Error(`Unable to update draft status: ${error.message}`);
    }

    const updatedDraft = await getDraftDetail({
      draftId,
      currentUserId: user.id,
    });
    return Response.json({ draft: updatedDraft }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update draft status.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "Draft not found." ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
