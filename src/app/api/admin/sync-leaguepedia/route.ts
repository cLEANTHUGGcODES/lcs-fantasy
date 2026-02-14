import leagueConfigData from "@/data/friends-league.json";
import {
  aggregatePlayerTotals,
  applyScoringToGames,
  buildLeagueStandings,
  topSingleGamePerformances,
} from "@/lib/fantasy";
import { fetchLeaguepediaSnapshot } from "@/lib/leaguepedia";
import { getActiveScoringSettings } from "@/lib/scoring-settings";
import {
  storeSnapshotInSupabase,
  tryGetLatestSnapshotFromSupabase,
} from "@/lib/supabase-match-store";
import type { FantasySnapshot, LeagueConfig } from "@/types/fantasy";

const leagueConfig = leagueConfigData as LeagueConfig;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readSnapshotRevisionId = (payload: unknown): number | null => {
  if (!isObject(payload)) {
    return null;
  }
  const value = payload.sourceRevisionId;
  return typeof value === "number" ? value : null;
};

const snapshotHasTeamIconFields = (payload: unknown): boolean => {
  if (!isObject(payload)) {
    return false;
  }

  const games = payload.games;
  if (!Array.isArray(games) || games.length === 0) {
    return false;
  }

  return games.every(
    (game) =>
      isObject(game) &&
      "blueTeamIconUrl" in game &&
      "redTeamIconUrl" in game,
  );
};

const validateSyncToken = (request: Request): boolean => {
  const expectedToken = process.env.SYNC_API_TOKEN;
  if (!expectedToken) {
    return true;
  }

  const providedToken = request.headers.get("x-sync-token");
  return providedToken === expectedToken;
};

export async function POST(request: Request) {
  if (!validateSyncToken(request)) {
    return Response.json(
      {
        error: "unauthorized",
        message: "Missing or invalid x-sync-token.",
      },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedSourcePage =
    searchParams.get("page") ??
    process.env.LEAGUEPEDIA_PAGE ??
    leagueConfig.sourcePage;

  try {
    const sourceSnapshot = await fetchLeaguepediaSnapshot(requestedSourcePage);
    const sourcePage = sourceSnapshot.sourcePage;

    const previous = await tryGetLatestSnapshotFromSupabase(sourcePage);
    const previousRevision = previous
      ? readSnapshotRevisionId(previous.payload)
      : null;
    const previousHasTeamIcons = previous
      ? snapshotHasTeamIconFields(previous.payload)
      : false;
    const sourceRevision = sourceSnapshot.sourceRevisionId;
    if (
      previous &&
      sourceRevision !== null &&
      previousRevision !== null &&
      previousRevision === sourceRevision &&
      previousHasTeamIcons
    ) {
      return Response.json(
        {
          ok: true,
          updated: false,
          sourcePage,
          sourceRevisionId: sourceRevision,
          storedAt: previous.storedAt,
          message: "No new revision on Leaguepedia; snapshot unchanged.",
        },
        { status: 200 },
      );
    }

    const { scoring } = await getActiveScoringSettings();
    const games = applyScoringToGames(sourceSnapshot.games, scoring);
    const playerTotals = aggregatePlayerTotals(games);
    const standings = buildLeagueStandings(playerTotals, leagueConfig.rosters);
    const topPerformances = topSingleGamePerformances(games, 15);

    const snapshot: Omit<FantasySnapshot, "generatedAt"> = {
      sourcePage,
      leagueName: leagueConfig.leagueName,
      scoring,
      rosters: leagueConfig.rosters,
      sourceRevisionId: sourceSnapshot.sourceRevisionId,
      sourceCheckedAt: sourceSnapshot.fetchedAt,
      matchCount: games.length,
      playerCount: playerTotals.length,
      games,
      playerTotals,
      standings,
      topPerformances,
    };

    const stored = await storeSnapshotInSupabase({
      snapshot,
      createdBy: "api-sync-leaguepedia",
    });

    return Response.json(
      {
        ok: true,
        updated: true,
        sourcePage: stored.sourcePage,
        storedAt: stored.storedAt,
        sourceRevisionId: sourceSnapshot.sourceRevisionId,
        matchCount: snapshot.matchCount,
        playerCount: snapshot.playerCount,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown sync failure";
    return Response.json(
      {
        error: "sync_failed",
        message,
      },
      { status: 500 },
    );
  }
}
