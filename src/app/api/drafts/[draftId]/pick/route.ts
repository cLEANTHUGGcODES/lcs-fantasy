import { requireAuthUser } from "@/lib/draft-auth";
import { processDueDrafts, submitDraftPickAtomic } from "@/lib/draft-automation";
import { recordDraftObservabilityEvents } from "@/lib/draft-observability";
import { getDraftDetail } from "@/lib/draft-data";
import { RouteServerTimer } from "@/lib/server-timing";
import { getSupabaseServerClient } from "@/lib/supabase-server";
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
    const body = await timer.measure("parse_body", async () => (await request.json()) as PickBody);
    const requestedPlayerName = (body.playerName ?? body.teamName)?.trim();

    if (!requestedPlayerName) {
      metricStatusCode = 400;
      return jsonWithTiming({ error: "playerName is required." }, metricStatusCode);
    }

    await timer.measure("process_due_before", () => processDueDrafts({ draftId }));
    const draftBeforePick = await timer.measure("load_draft_before", () =>
      getDraftDetail({
        draftId,
        currentUserId: user.id,
      }),
    );

    if (draftBeforePick.status !== "live" || !draftBeforePick.nextPick) {
      metricStatusCode = 400;
      return jsonWithTiming(
        {
          error: "Draft is not currently accepting manual picks.",
          code: "NOT_LIVE",
        },
        metricStatusCode,
      );
    }

    if (draftBeforePick.nextPick.participantUserId !== user.id) {
      metricStatusCode = 403;
      return jsonWithTiming(
        {
          error: `It is currently ${draftBeforePick.nextPick.participantDisplayName}'s turn to pick.`,
          code: "OUT_OF_TURN",
        },
        metricStatusCode,
      );
    }

    const pickedByLabel = getUserDisplayName(user) ?? user.id;
    const submission = await timer.measure("submit_pick_atomic", () =>
      submitDraftPickAtomic({
        draftId,
        userId: user.id,
        userLabel: pickedByLabel,
        playerName: requestedPlayerName,
      }),
    );
    if (!submission.ok) {
      if (submission.code === "PICK_DEADLINE_EXPIRED") {
        await timer.measure("process_due_expired", () => processDueDrafts({ draftId }));
      }
      metricStatusCode =
        submission.code === "NOT_PARTICIPANT" || submission.code === "OUT_OF_TURN" ? 403 : 400;
      return jsonWithTiming(
        {
          error: submission.error ?? "Unable to submit pick.",
          code: submission.code,
        },
        metricStatusCode,
      );
    }

    const updatedDraft = await timer.measure("load_draft_after", () =>
      getDraftDetail({
        draftId,
        currentUserId: user.id,
      }),
    );
    return jsonWithTiming({ draft: updatedDraft }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit pick.";
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
            metricName: "server_draft_pick_latency_ms",
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
