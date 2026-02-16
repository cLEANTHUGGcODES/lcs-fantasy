import { requireAuthUser } from "@/lib/draft-auth";
import { processDueDrafts } from "@/lib/draft-automation";
import { recordDraftObservabilityEvents } from "@/lib/draft-observability";
import { getDraftDetail } from "@/lib/draft-data";
import { RouteServerTimer } from "@/lib/server-timing";
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
  const timer = new RouteServerTimer();
  let metricUserId: string | null = null;
  let metricDraftId: number | null = null;
  let metricStatusCode = 200;
  const jsonWithTiming = (payload: unknown, status: number) =>
    Response.json(payload, {
      status,
      headers: {
        "server-timing": timer.toHeaderValue(),
      },
    });

  try {
    const user = await timer.measure("auth", () => requireAuthUser(undefined, request));
    metricUserId = user.id;
    const draftId = await timer.measure(
      "parse_draft_id",
      async () => parseDraftId((await params).draftId),
    );
    metricDraftId = draftId;
    const body = await timer.measure("parse_body", async () => (await request.json()) as StatusBody);
    const targetStatus = body.status;
    const force = body.force === true;

    if (
      targetStatus !== "scheduled" &&
      targetStatus !== "live" &&
      targetStatus !== "paused" &&
      targetStatus !== "completed"
    ) {
      metricStatusCode = 400;
      return jsonWithTiming({ error: "Invalid status." }, metricStatusCode);
    }

    await timer.measure("process_due_before", () => processDueDrafts({ draftId }));

    const detail = await timer.measure("load_draft_detail", () =>
      getDraftDetail({
        draftId,
        currentUserId: user.id,
      }),
    );

    if (!detail.isCommissioner) {
      metricStatusCode = 403;
      return jsonWithTiming(
        { error: "Only the commissioner can update draft status." },
        metricStatusCode,
      );
    }

    if (!isValidTransition(detail.status, targetStatus)) {
      metricStatusCode = 400;
      return jsonWithTiming(
        {
          error: `Invalid status transition from ${detail.status} to ${targetStatus}.`,
        },
        metricStatusCode,
      );
    }

    if (
      targetStatus === "live" &&
      detail.status !== "live" &&
      !force &&
      (!detail.allParticipantsPresent || !detail.allParticipantsReady)
    ) {
      metricStatusCode = 400;
      return jsonWithTiming(
        {
          error:
            `Cannot start draft until all participants are present and ready. ` +
            `Present ${detail.presentParticipantCount}/${detail.participantCount}, ` +
            `Ready ${detail.readyParticipantCount}/${detail.participantCount}.`,
        },
        metricStatusCode,
      );
    }

    const update: Record<string, unknown> = {
      status: targetStatus,
    };
    if (targetStatus === "live" && !detail.startedAt) {
      update.started_at = new Date().toISOString();
    }

    const supabase = getSupabaseServerClient();
    const { error } = await timer.measure("persist_status", () =>
      supabase
        .from("fantasy_drafts")
        .update(update)
        .eq("id", detail.id),
    );

    if (error) {
      throw new Error(`Unable to update draft status: ${error.message}`);
    }

    const updatedDraft = await timer.measure("load_draft_after", () =>
      getDraftDetail({
        draftId,
        currentUserId: user.id,
      }),
    );
    return jsonWithTiming({ draft: updatedDraft }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update draft status.";
    metricStatusCode = message === "UNAUTHORIZED" ? 401 : message === "Draft not found." ? 404 : 500;
    return jsonWithTiming({ error: message }, metricStatusCode);
  } finally {
    if (metricUserId) {
      void recordDraftObservabilityEvents({
        supabase: getSupabaseServerClient(),
        userId: metricUserId,
        source: "server",
        events: [
          {
            metricName: "server_draft_status_latency_ms",
            metricValue: timer.getTotalDurationMs(),
            metadata: {
              statusCode: metricStatusCode,
              draftId: metricDraftId,
              stepsMs: Object.fromEntries(
                timer
                  .getEntries()
                  .map((entry) => [entry.name, Math.round(entry.durationMs)]),
              ),
            },
          },
        ],
      }).catch(() => undefined);
    }
  }
}
