import { requireAuthUser } from "@/lib/draft-auth";
import { processDueDrafts, submitDraftPickAtomic } from "@/lib/draft-automation";
import { getDraftDetail } from "@/lib/draft-data";
import { getUserDisplayName } from "@/lib/user-profile";

type PickBody = {
  playerName?: string;
  teamName?: string;
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
    const body = (await request.json()) as PickBody;
    const requestedPlayerName = (body.playerName ?? body.teamName)?.trim();

    if (!requestedPlayerName) {
      return Response.json({ error: "playerName is required." }, { status: 400 });
    }

    await processDueDrafts({ draftId });
    const pickedByLabel = getUserDisplayName(user) ?? user.id;
    const submission = await submitDraftPickAtomic({
      draftId,
      userId: user.id,
      userLabel: pickedByLabel,
      playerName: requestedPlayerName,
    });
    if (!submission.ok) {
      if (submission.code === "PICK_DEADLINE_EXPIRED") {
        await processDueDrafts({ draftId });
      }
      const status =
        submission.code === "NOT_PARTICIPANT" || submission.code === "OUT_OF_TURN" ? 403 : 400;
      return Response.json(
        {
          error: submission.error ?? "Unable to submit pick.",
        },
        { status },
      );
    }

    await processDueDrafts({ draftId });
    const updatedDraft = await getDraftDetail({
      draftId,
      currentUserId: user.id,
    });
    return Response.json({ draft: updatedDraft }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit pick.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "Draft not found." ? 404 : 500;
    return Response.json({ error: message }, { status });
  }
}
