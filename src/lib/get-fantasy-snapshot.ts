import leagueConfigData from "@/data/friends-league.json";
import {
  aggregatePlayerTotals,
  applyScoringToGames,
  buildLeagueStandings,
  topSingleGamePerformances,
} from "@/lib/fantasy";
import { getActiveScoringSettings } from "@/lib/scoring-settings";
import { syncLeaguepediaSnapshot } from "@/lib/snapshot-sync";
import { tryGetLatestSnapshotFromSupabase } from "@/lib/supabase-match-store";
import type { FantasySnapshot, LeagueConfig } from "@/types/fantasy";

const leagueConfig = leagueConfigData as LeagueConfig;
const readPositiveInteger = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const AUTO_SYNC_ON_READ_ENABLED = process.env.AUTO_SYNC_ON_READ !== "false";
const AUTO_SYNC_STALE_MINUTES = readPositiveInteger(
  process.env.AUTO_SYNC_STALE_MINUTES,
  10,
);
const AUTO_SYNC_MIN_ATTEMPT_SECONDS = readPositiveInteger(
  process.env.AUTO_SYNC_MIN_ATTEMPT_SECONDS,
  45,
);

let inFlightAutoSync: Promise<void> | null = null;
let lastAutoSyncAttemptAtMs = 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasFullSnapshotShape = (
  value: unknown,
): value is Omit<FantasySnapshot, "generatedAt"> & { generatedAt?: string } =>
  isObject(value) &&
  Array.isArray(value.games) &&
  isObject(value.scoring) &&
  Array.isArray(value.rosters) &&
  Array.isArray(value.playerTotals) &&
  Array.isArray(value.standings) &&
  Array.isArray(value.topPerformances);

const snapshotAgeMinutes = (storedAt: string): number => {
  const timestamp = new Date(storedAt).getTime();
  if (!Number.isFinite(timestamp)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (Date.now() - timestamp) / 60000);
};

const isSnapshotStale = (storedAt: string | null): boolean => {
  if (!storedAt) {
    return true;
  }
  return snapshotAgeMinutes(storedAt) >= AUTO_SYNC_STALE_MINUTES;
};

const maybeAutoSyncSnapshot = async ({
  sourcePage,
  storedAt,
}: {
  sourcePage: string;
  storedAt: string | null;
}): Promise<boolean> => {
  if (!AUTO_SYNC_ON_READ_ENABLED || !isSnapshotStale(storedAt)) {
    return false;
  }

  if (inFlightAutoSync) {
    await inFlightAutoSync;
    return true;
  }

  const now = Date.now();
  if (now - lastAutoSyncAttemptAtMs < AUTO_SYNC_MIN_ATTEMPT_SECONDS * 1000) {
    return false;
  }

  lastAutoSyncAttemptAtMs = now;
  inFlightAutoSync = (async () => {
    try {
      await syncLeaguepediaSnapshot({
        requestedSourcePage: sourcePage,
        createdBy: "auto-sync-on-read",
      });
    } catch {
      // Keep serving latest stored snapshot; a later request can retry sync.
    } finally {
      inFlightAutoSync = null;
    }
  })();

  await inFlightAutoSync;
  return true;
};

export const getFantasySnapshot = async (): Promise<FantasySnapshot> => {
  const sourcePage = process.env.LEAGUEPEDIA_PAGE ?? leagueConfig.sourcePage;
  let latest = await tryGetLatestSnapshotFromSupabase(sourcePage);
  const didAttemptAutoSync = await maybeAutoSyncSnapshot({
    sourcePage,
    storedAt: latest?.storedAt ?? null,
  });

  if (didAttemptAutoSync || !latest) {
    latest = await tryGetLatestSnapshotFromSupabase(sourcePage);
  }

  if (!latest) {
    throw new Error(
      `No snapshot found in Supabase for "${sourcePage}". Run /api/admin/sync-leaguepedia to initialize.`,
    );
  }

  const { payload, storedAt } = latest;

  if (!hasFullSnapshotShape(payload)) {
    throw new Error(
      `Supabase snapshot for "${sourcePage}" is missing scoring/standings payload. Run /api/admin/sync-leaguepedia to refresh.`,
    );
  }

  const { scoring } = await getActiveScoringSettings();
  const games = applyScoringToGames(payload.games, scoring);
  const playerTotals = aggregatePlayerTotals(games);
  const standings = buildLeagueStandings(playerTotals, payload.rosters);
  const topPerformances = topSingleGamePerformances(games, 15);

  return {
    generatedAt: payload.generatedAt ?? storedAt,
    sourcePage: payload.sourcePage,
    leagueName: payload.leagueName,
    scoring,
    rosters: payload.rosters,
    matchCount: games.length,
    playerCount: playerTotals.length,
    games,
    playerTotals,
    standings,
    topPerformances,
  };
};
