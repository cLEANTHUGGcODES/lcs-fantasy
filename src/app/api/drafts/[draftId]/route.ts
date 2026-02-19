import { requireAuthUser } from "@/lib/draft-auth";
import { isGlobalAdminUser } from "@/lib/admin-access";
import { processDueDrafts } from "@/lib/draft-automation";
import { recordDraftObservabilityEvents } from "@/lib/draft-observability";
import { getDraftDetail } from "@/lib/draft-data";
import { RouteServerTimer } from "@/lib/server-timing";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const parseDraftId = (raw: string): number => {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error("Invalid draft id.");
  }
  return value;
};

const parseProcessDueFlag = (value: string | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

export async function GET(
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
    const requestUrl = new URL(request.url);
    const shouldProcessDue = parseProcessDueFlag(requestUrl.searchParams.get("processDue"));
    const draftId = await timer.measure(
      "parse_draft_id",
      async () => parseDraftId((await params).draftId),
    );
    metricDraftId = draftId;
    if (shouldProcessDue) {
      await timer.measure("process_due", () => processDueDrafts({ draftId }));
    }
    const draft = await timer.measure("load_draft_detail", () =>
      getDraftDetail({
        draftId,
        currentUserId: user.id,
      }),
    );
    return jsonWithTiming({ draft }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load draft.";
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
            metricName: "server_draft_detail_latency_ms",
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ draftId: string }> },
) {
  try {
    const user = await requireAuthUser();
    const canManageAllDrafts = await isGlobalAdminUser({ userId: user.id });
    const draftId = parseDraftId((await params).draftId);
    const supabase = getSupabaseServerClient();

    const { data: draft, error: draftError } = await supabase
      .from("fantasy_drafts")
      .select("id,created_by_user_id")
      .eq("id", draftId)
      .maybeSingle<{ id: number; created_by_user_id: string }>();

    if (draftError) {
      throw new Error(`Unable to load draft: ${draftError.message}`);
    }
    if (!draft) {
      return Response.json({ error: "Draft not found." }, { status: 404 });
    }
    if (draft.created_by_user_id !== user.id && !canManageAllDrafts) {
      return Response.json(
        { error: "Only the draft commissioner can delete this draft." },
        { status: 403 },
      );
    }

    const { error: deleteError } = await supabase
      .from("fantasy_drafts")
      .delete()
      .eq("id", draftId);

    if (deleteError) {
      throw new Error(`Unable to delete draft: ${deleteError.message}`);
    }

    return Response.json({ ok: true, draftId }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete draft.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
