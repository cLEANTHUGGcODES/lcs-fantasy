import { requireAuthUser } from "@/lib/draft-auth";
import { recordChatObservabilityEvents } from "@/lib/global-chat";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";

type ChatClientMetricsBody = {
  realtimeDisconnects?: number;
  fallbackSyncs?: number;
  duplicateDrops?: number;
};

const normalizeCount = (value: unknown, maxValue: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(Math.floor(value), maxValue));
};

export async function POST(request: Request) {
  try {
    const supabase = await getSupabaseAuthServerClient();
    const user = await requireAuthUser(supabase);
    const body = (await request.json()) as ChatClientMetricsBody;

    const realtimeDisconnects = normalizeCount(body.realtimeDisconnects, 1000);
    const fallbackSyncs = normalizeCount(body.fallbackSyncs, 2000);
    const duplicateDrops = normalizeCount(body.duplicateDrops, 5000);

    await recordChatObservabilityEvents({
      supabase,
      userId: user.id,
      source: "client",
      events: [
        {
          metricName: "realtime_disconnect",
          metricValue: realtimeDisconnects,
        },
        {
          metricName: "fallback_sync",
          metricValue: fallbackSyncs,
        },
        {
          metricName: "duplicate_drop",
          metricValue: duplicateDrops,
        },
      ],
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to record chat metrics.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
