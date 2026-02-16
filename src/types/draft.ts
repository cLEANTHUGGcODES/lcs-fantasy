export type DraftStatus = "scheduled" | "live" | "paused" | "completed";

export interface RegisteredUser {
  userId: string;
  email: string | null;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  teamName: string | null;
}

export interface DraftSummary {
  id: number;
  name: string;
  leagueSlug: string;
  seasonYear: number;
  sourcePage: string;
  scheduledAt: string;
  startedAt: string | null;
  roundCount: number;
  pickSeconds: number;
  status: DraftStatus;
  createdByUserId: string;
  createdByLabel: string | null;
  participantCount: number;
  pickCount: number;
  totalPickCount: number;
  createdAt: string;
}

export interface DraftParticipant {
  id: number;
  draftId: number;
  userId: string;
  email: string | null;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  teamName: string | null;
  draftPosition: number;
  createdAt: string;
}

export interface DraftPlayerPoolEntry {
  id: number;
  draftId: number;
  playerName: string;
  playerTeam: string | null;
  playerRole: string | null;
  teamIconUrl: string | null;
  sourcePage: string;
  createdAt: string;
  analytics?: DraftPlayerAnalytics | null;
}

export interface DraftPlayerChampionSummary {
  champion: string;
  games: number;
  winRate: number;
  averageFantasyPoints: number;
}

export interface DraftPlayerAnalytics {
  overallRank: number | null;
  positionRank: number | null;
  gamesPlayed: number;
  averageFantasyPoints: number | null;
  winRate: number | null;
  topChampions: DraftPlayerChampionSummary[];
}

export interface DraftPick {
  id: number;
  draftId: number;
  overallPick: number;
  roundNumber: number;
  roundPick: number;
  participantUserId: string;
  participantDisplayName: string;
  playerName: string;
  playerTeam: string | null;
  playerRole: string | null;
  teamIconUrl: string | null;
  pickedByUserId: string;
  pickedByLabel: string | null;
  pickedAt: string;
}

export interface DraftNextPick {
  overallPick: number;
  roundNumber: number;
  roundPick: number;
  participantUserId: string;
  participantDisplayName: string;
  draftPosition: number;
}

export interface DraftParticipantPresence {
  userId: string;
  displayName: string;
  isOnline: boolean;
  isReady: boolean;
  lastSeenAt: string | null;
}

export interface DraftDetail extends DraftSummary {
  participants: DraftParticipant[];
  picks: DraftPick[];
  playerPool: DraftPlayerPoolEntry[];
  availablePlayers: DraftPlayerPoolEntry[];
  nextPick: DraftNextPick | null;
  currentPickDeadlineAt: string | null;
  isCommissioner: boolean;
  serverNow: string;
  participantPresence: DraftParticipantPresence[];
  presentParticipantCount: number;
  readyParticipantCount: number;
  allParticipantsPresent: boolean;
  allParticipantsReady: boolean;
}
