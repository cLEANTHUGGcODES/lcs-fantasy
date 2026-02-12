import leagueConfigData from "@/data/friends-league.json";
import { getLatestSnapshotFromSupabase } from "@/lib/supabase-match-store";
import type { LeagueConfig } from "@/types/fantasy";

const leagueConfig = leagueConfigData as LeagueConfig;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readNumber = (value: unknown): number | null =>
  typeof value === "number" ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export async function GET() {
  const sourcePage = process.env.LEAGUEPEDIA_PAGE ?? leagueConfig.sourcePage;
  const staleAfterMinutes = Number.parseInt(
    process.env.SNAPSHOT_STALE_MINUTES ?? "30",
    10,
  );

  try {
    const latest = await getLatestSnapshotFromSupabase(sourcePage);
    const generatedAt = new Date(latest.storedAt);
    const now = new Date();
    const ageMinutes = (now.getTime() - generatedAt.getTime()) / 60000;
    const payload = latest.payload;

    const sourceRevisionId = isObject(payload)
      ? readNumber(payload.sourceRevisionId)
      : null;
    const sourceCheckedAt = isObject(payload)
      ? readString(payload.sourceCheckedAt)
      : null;

    return Response.json(
      {
        ok: true,
        sourcePage,
        storedAt: latest.storedAt,
        sourceRevisionId,
        sourceCheckedAt,
        ageMinutes: Math.round(ageMinutes * 100) / 100,
        staleAfterMinutes,
        isStale: ageMinutes > staleAfterMinutes,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Snapshot status unavailable";
    return Response.json(
      {
        ok: false,
        sourcePage,
        error: message,
      },
      { status: 500 },
    );
  }
}
