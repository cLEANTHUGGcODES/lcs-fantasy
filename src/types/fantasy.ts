export type TeamSide = "blue" | "red";
export type PlayerRole = "TOP" | "JNG" | "MID" | "ADC" | "SUP" | "FLEX";

export interface PlayerGameStat {
  name: string;
  pageTitle?: string | null;
  team: string;
  side: TeamSide;
  role: PlayerRole;
  champion: string;
  championIconUrl?: string | null;
  championSpriteUrl?: string | null;
  championSpriteBackgroundPosition?: string | null;
  championSpriteBackgroundSize?: string | null;
  kills: number;
  deaths: number;
  assists: number;
  cs: number | null;
  gold: number | null;
  won: boolean;
  fantasyPoints?: number;
}

export interface ParsedGame {
  id: string;
  matchNumber: number;
  blueTeam: string;
  redTeam: string;
  blueTeamPage?: string | null;
  redTeamPage?: string | null;
  blueTeamIconUrl: string | null;
  redTeamIconUrl: string | null;
  winner: string | null;
  duration: string | null;
  patch: string | null;
  playedAtRaw: string | null;
  playedAtLabel: string | null;
  blueKills: number | null;
  redKills: number | null;
  players: PlayerGameStat[];
}

export interface FantasyScoring {
  kill: number;
  death: number;
  assist: number;
  win: number;
  csPer100: number;
  goldPer1000: number;
}

export interface FriendRoster {
  friend: string;
  players: string[];
}

export interface LeagueConfig {
  leagueName: string;
  sourcePage: string;
  scoring?: Partial<FantasyScoring>;
  rosters: FriendRoster[];
}

export interface PlayerTotal {
  player: string;
  team: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  fantasyPoints: number;
  averagePoints: number;
}

export interface FriendStanding {
  friend: string;
  totalPoints: number;
  averagePerPick: number;
  breakdown: {
    player: string;
    points: number;
    games: number;
  }[];
}

export interface SingleGamePerformance {
  gameId: string;
  player: string;
  team: string;
  opponent: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  won: boolean;
  fantasyPoints: number;
  playedAtLabel: string | null;
}

export interface FantasySnapshot {
  generatedAt: string;
  sourcePage: string;
  sourceRevisionId?: number | null;
  sourceCheckedAt?: string;
  leagueName: string;
  scoring: FantasyScoring;
  rosters: FriendRoster[];
  matchCount: number;
  playerCount: number;
  games: ParsedGame[];
  playerTotals: PlayerTotal[];
  standings: FriendStanding[];
  topPerformances: SingleGamePerformance[];
}
