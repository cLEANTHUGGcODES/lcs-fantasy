import type {
  FantasyScoring,
  FriendRoster,
  FriendStanding,
  ParsedGame,
  PlayerTotal,
  SingleGamePerformance,
} from "@/types/fantasy";

export const DEFAULT_SCORING: FantasyScoring = {
  kill: 3,
  death: -1,
  assist: 2,
  win: 0,
  csPer100: 1,
  goldPer1000: 0,
};

export const resolveScoringConfig = (
  custom?: Partial<FantasyScoring>,
): FantasyScoring => ({
  ...DEFAULT_SCORING,
  ...(custom ?? {}),
});

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const playerKey = (name: string): string => name.trim().toLowerCase();

export const calculateFantasyPoints = (
  kills: number,
  deaths: number,
  assists: number,
  won: boolean,
  cs: number | null,
  gold: number | null,
  scoring: FantasyScoring,
): number => {
  const base =
    kills * scoring.kill +
    deaths * scoring.death +
    assists * scoring.assist +
    (won ? scoring.win : 0);
  const csBonus = cs ? (cs / 100) * scoring.csPer100 : 0;
  const goldBonus = gold ? (gold / 1000) * scoring.goldPer1000 : 0;

  return round(base + csBonus + goldBonus);
};

export const applyScoringToGames = (
  games: ParsedGame[],
  scoring: FantasyScoring,
): ParsedGame[] =>
  games.map((game) => ({
    ...game,
    players: game.players.map((player) => ({
      ...player,
      fantasyPoints: calculateFantasyPoints(
        player.kills,
        player.deaths,
        player.assists,
        player.won,
        player.cs,
        player.gold,
        scoring,
      ),
    })),
  }));

export const aggregatePlayerTotals = (games: ParsedGame[]): PlayerTotal[] => {
  const totals = new Map<string, PlayerTotal>();

  for (const game of games) {
    for (const player of game.players) {
      const key = playerKey(player.name);
      const fantasyPoints = player.fantasyPoints ?? 0;
      const existing = totals.get(key);

      if (!existing) {
        totals.set(key, {
          player: player.name,
          team: player.team,
          games: 1,
          wins: player.won ? 1 : 0,
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          fantasyPoints,
          averagePoints: fantasyPoints,
        });
        continue;
      }

      existing.team = player.team;
      existing.games += 1;
      existing.wins += player.won ? 1 : 0;
      existing.kills += player.kills;
      existing.deaths += player.deaths;
      existing.assists += player.assists;
      existing.fantasyPoints = round(existing.fantasyPoints + fantasyPoints);
      existing.averagePoints = round(existing.fantasyPoints / existing.games);
    }
  }

  return [...totals.values()].sort((a, b) => b.fantasyPoints - a.fantasyPoints);
};

export const buildLeagueStandings = (
  playerTotals: PlayerTotal[],
  rosters: FriendRoster[],
): FriendStanding[] => {
  const totalsByPlayer = new Map(
    playerTotals.map((entry) => [playerKey(entry.player), entry]),
  );

  return rosters
    .map((roster) => {
      const breakdown = roster.players.map((pickedPlayer) => {
        const found = totalsByPlayer.get(playerKey(pickedPlayer));
        return {
          player: pickedPlayer,
          points: found?.fantasyPoints ?? 0,
          games: found?.games ?? 0,
        };
      });

      const totalPoints = round(
        breakdown.reduce((acc, item) => acc + item.points, 0),
      );
      const averagePerPick =
        breakdown.length > 0 ? round(totalPoints / breakdown.length) : 0;

      return {
        friend: roster.friend,
        totalPoints,
        averagePerPick,
        breakdown,
      };
    })
    .sort((a, b) => b.totalPoints - a.totalPoints);
};

export const topSingleGamePerformances = (
  games: ParsedGame[],
  limit = 12,
): SingleGamePerformance[] => {
  const flat: SingleGamePerformance[] = games.flatMap((game) =>
    game.players.map((player) => ({
      gameId: game.id,
      player: player.name,
      team: player.team,
      opponent: player.side === "blue" ? game.redTeam : game.blueTeam,
      champion: player.champion,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
      won: player.won,
      fantasyPoints: player.fantasyPoints ?? 0,
      playedAtLabel: game.playedAtLabel,
    })),
  );

  return flat.sort((a, b) => b.fantasyPoints - a.fantasyPoints).slice(0, limit);
};
