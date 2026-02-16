import { isGlobalAdminUser } from "@/lib/admin-access";
import { requireAuthUser } from "@/lib/draft-auth";
import {
  getDraftObservabilitySummary,
  recordDraftObservabilityEvents,
  type DraftObservabilityEventInput,
  type DraftObservabilityMetricName,
} from "@/lib/draft-observability";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";

type DraftClientMetricsBody = {
  events?: Array<{
    metricName?: string;
    metricValue?: number;
    metadata?: Record<string, unknown>;
  }>;
  realtimeDisconnects?: number;
  refreshRetries?: number;
};

const MAX_BATCH_SIZE = 30;
const MAX_METRIC_VALUE = 600_000;
const CLIENT_METRIC_NAMES = new Set<DraftObservabilityMetricName>([
  "client_draft_refresh_latency_ms",
  "client_draft_presence_latency_ms",
  "client_draft_pick_latency_ms",
  "client_draft_status_latency_ms",
  "client_realtime_disconnect",
  "client_refresh_retry",
]);

const parseWindowMinutes = (value: string | null): number => {
  if (!value) {
    return 1440;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1440;
  }
  return Math.min(parsed, 7 * 24 * 60);
};

const asMetricName = (value: unknown): DraftObservabilityMetricName | null => {
  if (typeof value !== "string") {
    return null;
  }
  return CLIENT_METRIC_NAMES.has(value as DraftObservabilityMetricName)
    ? (value as DraftObservabilityMetricName)
    : null;
};

const asMetricValue = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(value), MAX_METRIC_VALUE));
};

export async function GET(request: Request) {
  try {
    const user = await requireAuthUser(undefined, request);
    const isAdmin = await isGlobalAdminUser({ userId: user.id });
    if (!isAdmin) {
      return Response.json({ error: "Only admins can view draft observability." }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const windowMinutes = parseWindowMinutes(searchParams.get("windowMinutes"));
    const summary = await getDraftObservabilitySummary({ windowMinutes });
    return Response.json({ ok: true, summary }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load draft observability.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseAuthServerClient();
    const user = await requireAuthUser(supabase, request);
    const body = (await request.json().catch(() => ({}))) as DraftClientMetricsBody;

    const eventsFromBody: DraftObservabilityEventInput[] = [];
    if (Array.isArray(body.events)) {
      for (const entry of body.events.slice(0, MAX_BATCH_SIZE)) {
        const metricName = asMetricName(entry?.metricName);
        const metricValue = asMetricValue(entry?.metricValue);
        if (!metricName || metricValue < 1) {
          continue;
        }

        eventsFromBody.push({
          metricName,
          metricValue,
          metadata:
            entry?.metadata && typeof entry.metadata === "object" ? entry.metadata : undefined,
        });
      }
    }

    const realtimeDisconnects = asMetricValue(body.realtimeDisconnects);
    const refreshRetries = asMetricValue(body.refreshRetries);

    if (realtimeDisconnects > 0) {
      eventsFromBody.push({
        metricName: "client_realtime_disconnect",
        metricValue: realtimeDisconnects,
      });
    }
    if (refreshRetries > 0) {
      eventsFromBody.push({
        metricName: "client_refresh_retry",
        metricValue: refreshRetries,
      });
    }

    await recordDraftObservabilityEvents({
      supabase,
      userId: user.id,
      source: "client",
      events: eventsFromBody,
    });

    return Response.json({ ok: true, accepted: eventsFromBody.length }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record draft metrics.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
