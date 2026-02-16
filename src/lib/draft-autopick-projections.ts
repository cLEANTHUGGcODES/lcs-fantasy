import { calculateFantasyPoints, DEFAULT_SCORING } from "@/lib/fantasy";
import type { FantasyScoring, ParsedGame } from "@/types/fantasy";

type ProjectionCandidate = {
  playerName: string;
  playerTeam: string | null;
};

type ProjectionStats = {
  games: number;
  totalFantasyPoints: number;
};

const normalizeForKey = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? "";

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const resolveBasePlayerName = (entry: ProjectionCandidate): string => {
  const rawName = entry.playerName.trim();
  const team = entry.playerTeam?.trim();
  if (!team) {
    return rawName;
  }
  const suffix = ` (${team})`;
  if (!rawName.endsWith(suffix)) {
    return rawName;
  }
  return rawName.slice(0, -suffix.length).trim();
};

export const withProjectedAutopickFantasyAverages = <T extends ProjectionCandidate>(
  entries: T[],
  {
    games,
    scoring,
  }: {
    games: ParsedGame[];
    scoring?: Partial<FantasyScoring> | null;
  },
): Array<T & { projectedAvgFantasyPoints: number | null }> => {
  if (entries.length === 0 || games.length === 0) {
    return entries.map((entry) => ({
      ...entry,
      projectedAvgFantasyPoints: null,
    }));
  }

  const resolvedScoring: FantasyScoring = {
    ...DEFAULT_SCORING,
    ...(scoring ?? {}),
  };
  const statsByPlayerKey = new Map<string, ProjectionStats>();

  for (const game of games) {
    for (const player of game.players) {
      const playerName = player.name?.trim();
      const playerTeam = player.team?.trim();
      if (!playerName || !playerTeam) {
        continue;
      }

      const key = `${normalizeForKey(playerName)}::${normalizeForKey(playerTeam)}`;
      const fantasyPoints =
        typeof player.fantasyPoints === "number"
          ? player.fantasyPoints
          : calculateFantasyPoints(
              player.kills,
              player.deaths,
              player.assists,
              player.won,
              player.cs,
              player.gold,
              resolvedScoring,
            );
      const existing = statsByPlayerKey.get(key) ?? { games: 0, totalFantasyPoints: 0 };
      existing.games += 1;
      existing.totalFantasyPoints += fantasyPoints;
      statsByPlayerKey.set(key, existing);
    }
  }

  return entries.map((entry) => {
    const key = `${normalizeForKey(resolveBasePlayerName(entry))}::${normalizeForKey(entry.playerTeam)}`;
    const stats = statsByPlayerKey.get(key);
    const projectedAvgFantasyPoints =
      stats && stats.games > 0 ? round2(stats.totalFantasyPoints / stats.games) : null;

    return {
      ...entry,
      projectedAvgFantasyPoints,
    };
  });
};
