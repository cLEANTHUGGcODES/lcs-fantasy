import leagueConfigData from "@/data/friends-league.json";
import {
  aggregatePlayerTotals,
  applyScoringToGames,
  buildLeagueStandings,
  topSingleGamePerformances,
} from "@/lib/fantasy";
import { getActiveScoringSettings } from "@/lib/scoring-settings";
import { getLatestSnapshotFromSupabase } from "@/lib/supabase-match-store";
import type { FantasySnapshot, LeagueConfig } from "@/types/fantasy";

const leagueConfig = leagueConfigData as LeagueConfig;

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

export const getFantasySnapshot = async (): Promise<FantasySnapshot> => {
  const sourcePage = process.env.LEAGUEPEDIA_PAGE ?? leagueConfig.sourcePage;
  const { payload, storedAt } = await getLatestSnapshotFromSupabase(sourcePage);

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
