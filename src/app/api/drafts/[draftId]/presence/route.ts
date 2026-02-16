import { requireAuthUser } from "@/lib/draft-auth";
import { processDueDrafts } from "@/lib/draft-automation";
import { recordDraftObservabilityEvents } from "@/lib/draft-observability";
import { getDraftDetail, upsertDraftPresence } from "@/lib/draft-data";
import { RouteServerTimer } from "@/lib/server-timing";
import { getSupabaseServerClient } from "@/lib/supabase-server";

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
    const body = await timer.measure(
      "parse_body",
      async () => (await request.json().catch(() => ({}))) as PresenceBody,
    );
    const ready = typeof body.ready === "boolean" ? body.ready : undefined;

    const supabase = getSupabaseServerClient();
    const { data: participant, error: participantError } = await timer.measure(
      "verify_participant",
      () =>
        supabase
          .from("fantasy_draft_participants")
          .select("user_id")
          .eq("draft_id", draftId)
          .eq("user_id", user.id)
          .maybeSingle<{ user_id: string }>(),
    );

    if (participantError) {
      throw new Error(`Unable to verify draft participant: ${participantError.message}`);
    }
    if (!participant) {
      metricStatusCode = 403;
      return jsonWithTiming(
        { error: "Only draft participants can update presence." },
        metricStatusCode,
      );
    }

    await timer.measure("upsert_presence", () =>
      upsertDraftPresence({
        draftId,
        userId: user.id,
        isReady: ready,
      }),
    );

    if (typeof ready !== "boolean") {
      return jsonWithTiming(
        {
          ok: true,
          serverNow: new Date().toISOString(),
        },
        200,
      );
    }

    await timer.measure("process_due", () => processDueDrafts({ draftId }));

    const updatedDraft = await timer.measure("load_draft_detail", () =>
      getDraftDetail({
        draftId,
        currentUserId: user.id,
      }),
    );
    return jsonWithTiming({ ok: true, draft: updatedDraft }, 200);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to update draft presence.";
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
            metricName: "server_draft_presence_latency_ms",
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
