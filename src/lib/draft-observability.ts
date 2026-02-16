import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const DRAFT_OBSERVABILITY_TABLE = "fantasy_draft_observability_events";
const DRAFT_OBSERVABILITY_SUMMARY_RPC_NAME = "fantasy_draft_observability_summary";

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

export type DraftObservabilityMetricName =
  | "server_draft_detail_latency_ms"
  | "server_draft_presence_latency_ms"
  | "server_draft_pick_latency_ms"
  | "server_draft_status_latency_ms"
  | "client_draft_refresh_latency_ms"
  | "client_draft_presence_latency_ms"
  | "client_draft_pick_latency_ms"
  | "client_draft_status_latency_ms"
  | "client_realtime_disconnect"
  | "client_refresh_retry";

export type DraftObservabilityEventInput = {
  metricName: DraftObservabilityMetricName;
  metricValue: number;
  metadata?: Record<string, unknown>;
};

export const recordDraftObservabilityEvents = async ({
  supabase,
  userId,
  source,
  events,
}: {
  supabase: SupabaseClient;
  userId: string;
  source: "server" | "client";
  events: DraftObservabilityEventInput[];
}): Promise<void> => {
  const rows = events
    .map((entry) => {
      const normalizedValue = Math.max(0, Math.floor(entry.metricValue));
      if (!normalizedValue) {
        return null;
      }
      return {
        user_id: userId,
        source,
        metric_name: entry.metricName,
        metric_value: normalizedValue,
        metadata: entry.metadata ?? {},
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase.from(DRAFT_OBSERVABILITY_TABLE).insert(rows);
  if (error) {
    throw new Error(`Unable to record draft observability event: ${error.message}`);
  }
};

export const getDraftObservabilitySummary = async ({
  windowMinutes = 1440,
}: {
  windowMinutes?: number;
} = {}): Promise<Record<string, unknown>> => {
  const supabase = getSupabaseServerClient();
  const safeWindowMinutes = Math.max(1, Math.floor(windowMinutes));

  const { data, error } = await supabase.rpc(DRAFT_OBSERVABILITY_SUMMARY_RPC_NAME, {
    p_window_minutes: safeWindowMinutes,
  });
  if (error) {
    throw new Error(`Unable to load draft observability summary: ${error.message}`);
  }

  return asObject(data) ?? {};
};

