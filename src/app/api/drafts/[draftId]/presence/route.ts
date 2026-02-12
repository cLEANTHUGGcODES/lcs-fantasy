import { requireAuthUser } from "@/lib/draft-auth";
import { processDueDrafts } from "@/lib/draft-automation";
import { getDraftDetail, upsertDraftPresence } from "@/lib/draft-data";

type PresenceBody = {
  ready?: boolean;
};

const parseDraftId = (raw: string): number => {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error("Invalid draft id.");
  }
  return value;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  try {
    const user = await requireAuthUser();
    const draftId = parseDraftId((await params).draftId);
    const body = (await request.json().catch(() => ({}))) as PresenceBody;
    const ready = typeof body.ready === "boolean" ? body.ready : undefined;

    const draft = await getDraftDetail({
      draftId,
      currentUserId: user.id,
    });
    const participant = draft.participants.find((entry) => entry.userId === user.id);
    if (!participant) {
      return Response.json(
        { error: "Only draft participants can update presence." },
        { status: 403 },
      );
    }

    await upsertDraftPresence({
      draftId,
      userId: user.id,
      isReady: ready,
    });
    await processDueDrafts({ draftId });

    const updatedDraft = await getDraftDetail({
      draftId,
      currentUserId: user.id,
    });
    return Response.json({ draft: updatedDraft }, { status: 200 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update draft presence.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "Draft not found." ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
