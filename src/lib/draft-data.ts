import type { User } from "@supabase/supabase-js";
import { isGlobalAdminUser } from "@/lib/admin-access";
import { getPickSlot, resolveCurrentPickDeadline, resolveNextPick } from "@/lib/draft-engine";
import { withResolvedDraftPlayerImages } from "@/lib/draft-player-images";
import { calculateFantasyPoints, DEFAULT_SCORING } from "@/lib/fantasy";
import { getLatestSnapshotFromSupabase } from "@/lib/supabase-match-store";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import {
  formatUserLabelFromDisplayName,
  getUserDisplayName,
  getUserFirstName,
  getUserLastName,
  getUserTeamName,
} from "@/lib/user-profile";
import type {
  DraftDetail,
  DraftPlayerAnalytics,
  DraftParticipant,
  DraftParticipantPresence,
  DraftPlayerPoolEntry,
  DraftPick,
  DraftStatus,
  DraftSummary,
  RegisteredUser,
} from "@/types/draft";
import type { FantasyScoring, ParsedGame } from "@/types/fantasy";

const DRAFTS_TABLE = "fantasy_drafts";
const PARTICIPANTS_TABLE = "fantasy_draft_participants";
const PICKS_TABLE = "fantasy_draft_picks";
const TEAM_POOL_TABLE = "fantasy_draft_team_pool";
const PRESENCE_TABLE = "fantasy_draft_presence";
const ONLINE_HEARTBEAT_WINDOW_MS = 45_000;
const MAX_ROSTER_PLAYERS = 5;
const PLAYER_ANALYTICS_LOOKBACK_DAYS = 365;
const PLAYER_ANALYTICS_CACHE_TTL_MS = 60_000;
const TOP_CHAMPION_LIMIT = 3;

type SnapshotPayloadWithGames = {
  games: ParsedGame[];
  scoring?: Partial<FantasyScoring>;
};

type PlayerChampionAccumulator = {
  games: number;
  wins: number;
  totalFantasyPoints: number;
};

type PlayerAnalyticsAccumulator = {
  games: number;
  wins: number;
  totalFantasyPoints: number;
  champions: Map<string, PlayerChampionAccumulator>;
};

type CachedPlayerAnalytics = {
  cachedAtMs: number;
  analyticsByPlayerKey: Map<string, DraftPlayerAnalytics>;
};

const draftPlayerAnalyticsCache = new Map<string, CachedPlayerAnalytics>();

const normalizeForKey = (value: string | null | undefined): string =>
  value?.trim().toLowerCase() ?? "";

const round2 = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasSnapshotGames = (value: unknown): value is SnapshotPayloadWithGames =>
  isObject(value) &&
  Array.isArray(value.games);

const parseGameTimestampMs = (game: ParsedGame): number | null => {
  const label = game.playedAtLabel?.trim();
  if (label) {
    const normalized = label.includes("T") ? label : label.replace(" ", "T");
    const asLocalMs = Date.parse(normalized);
    if (Number.isFinite(asLocalMs)) {
      return asLocalMs;
    }
    const asUtcMs = Date.parse(`${normalized}:00Z`);
    if (Number.isFinite(asUtcMs)) {
      return asUtcMs;
    }
  }

  const raw = game.playedAtRaw?.trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split(",").map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length < 5 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  const [year, month, day, hour, minute] = parts;
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
};

const resolvePoolBasePlayerName = (player: DraftPlayerPoolEntry): string => {
  const rawName = player.playerName.trim();
  const team = player.playerTeam?.trim();
  if (!team) {
    return rawName;
  }
  const suffix = ` (${team})`;
  if (!rawName.endsWith(suffix)) {
    return rawName;
  }
  return rawName.slice(0, -suffix.length).trim();
};

const draftPoolPlayerKey = (player: DraftPlayerPoolEntry): string =>
  `${normalizeForKey(resolvePoolBasePlayerName(player))}::${normalizeForKey(player.playerTeam)}`;

const createEmptyAnalytics = (): DraftPlayerAnalytics => ({
  overallRank: null,
  positionRank: null,
  gamesPlayed: 0,
  averageFantasyPoints: null,
  winRate: null,
  topChampions: [],
});

const playerPoolFingerprint = (playerPool: DraftPlayerPoolEntry[]): string =>
  playerPool
    .map((entry) => `${normalizeForKey(resolvePoolBasePlayerName(entry))}::${normalizeForKey(entry.playerTeam)}`)
    .sort((left, right) => left.localeCompare(right))
    .join("|");

const buildPlayerAnalyticsByPool = async ({
  sourcePage,
  playerPool,
}: {
  sourcePage: string;
  playerPool: DraftPlayerPoolEntry[];
}): Promise<Map<string, DraftPlayerAnalytics>> => {
  if (!sourcePage || playerPool.length === 0) {
    return new Map();
  }

  const cacheKey = `${sourcePage}::${playerPoolFingerprint(playerPool)}`;
  const nowMs = Date.now();
  const cached = draftPlayerAnalyticsCache.get(cacheKey);
  if (cached && nowMs - cached.cachedAtMs <= PLAYER_ANALYTICS_CACHE_TTL_MS) {
    return cached.analyticsByPlayerKey;
  }

  let snapshotPayload: unknown = null;
  try {
    const snapshot = await getLatestSnapshotFromSupabase(sourcePage);
    snapshotPayload = snapshot.payload;
  } catch {
    snapshotPayload = null;
  }

  if (!hasSnapshotGames(snapshotPayload) || snapshotPayload.games.length === 0) {
    draftPlayerAnalyticsCache.set(cacheKey, {
      cachedAtMs: nowMs,
      analyticsByPlayerKey: new Map(),
    });
    return new Map();
  }

  const snapshotScoring: FantasyScoring = {
    ...DEFAULT_SCORING,
    ...(snapshotPayload.scoring ?? {}),
  };

  const cutoffMs = nowMs - PLAYER_ANALYTICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const datedGames = snapshotPayload.games
    .map((game) => ({ game, playedAtMs: parseGameTimestampMs(game) }))
    .filter((entry): entry is { game: ParsedGame; playedAtMs: number } => Number.isFinite(entry.playedAtMs));

  const filteredGames = datedGames.filter((entry) => entry.playedAtMs >= cutoffMs);
  const gamesForAnalytics =
    datedGames.length > 0
      ? (filteredGames.length > 0 ? filteredGames : datedGames).map((entry) => entry.game)
      : snapshotPayload.games;

  const byPlayerKey = new Map<string, PlayerAnalyticsAccumulator>();

  for (const game of gamesForAnalytics) {
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
              snapshotScoring,
            );
      const champion = player.champion?.trim() || "Unknown";

      const existing = byPlayerKey.get(key) ?? {
        games: 0,
        wins: 0,
        totalFantasyPoints: 0,
        champions: new Map<string, PlayerChampionAccumulator>(),
      };
      existing.games += 1;
      existing.wins += player.won ? 1 : 0;
      existing.totalFantasyPoints += fantasyPoints;

      const championEntry = existing.champions.get(champion) ?? {
        games: 0,
        wins: 0,
        totalFantasyPoints: 0,
      };
      championEntry.games += 1;
      championEntry.wins += player.won ? 1 : 0;
      championEntry.totalFantasyPoints += fantasyPoints;
      existing.champions.set(champion, championEntry);
      byPlayerKey.set(key, existing);
    }
  }

  const withAnalytics = playerPool.map((entry) => {
    const key = draftPoolPlayerKey(entry);
    const stats = byPlayerKey.get(key);
    if (!stats || stats.games < 1) {
      return {
        key,
        playerName: entry.playerName,
        playerRole: entry.playerRole,
        analytics: createEmptyAnalytics(),
      };
    }

    const averageFantasyPoints = round2(stats.totalFantasyPoints / stats.games);
    const winRate = round2((stats.wins / stats.games) * 100);
    const topChampions = [...stats.champions.entries()]
      .map(([champion, championStats]) => ({
        champion,
        games: championStats.games,
        winRate: round2((championStats.wins / championStats.games) * 100),
        averageFantasyPoints: round2(championStats.totalFantasyPoints / championStats.games),
      }))
      .sort((left, right) => {
        if (right.games !== left.games) {
          return right.games - left.games;
        }
        if (right.averageFantasyPoints !== left.averageFantasyPoints) {
          return right.averageFantasyPoints - left.averageFantasyPoints;
        }
        return left.champion.localeCompare(right.champion);
      })
      .slice(0, TOP_CHAMPION_LIMIT);

    return {
      key,
      playerName: entry.playerName,
      playerRole: entry.playerRole,
      analytics: {
        overallRank: null,
        positionRank: null,
        gamesPlayed: stats.games,
        averageFantasyPoints,
        winRate,
        topChampions,
      } satisfies DraftPlayerAnalytics,
    };
  });

  const compareRankableEntries = (
    left: (typeof withAnalytics)[number],
    right: (typeof withAnalytics)[number],
  ): number => {
    const leftAverage = left.analytics.averageFantasyPoints ?? Number.NEGATIVE_INFINITY;
    const rightAverage = right.analytics.averageFantasyPoints ?? Number.NEGATIVE_INFINITY;
    if (rightAverage !== leftAverage) {
      return rightAverage - leftAverage;
    }
    if (right.analytics.gamesPlayed !== left.analytics.gamesPlayed) {
      return right.analytics.gamesPlayed - left.analytics.gamesPlayed;
    }
    const leftWinRate = left.analytics.winRate ?? Number.NEGATIVE_INFINITY;
    const rightWinRate = right.analytics.winRate ?? Number.NEGATIVE_INFINITY;
    if (rightWinRate !== leftWinRate) {
      return rightWinRate - leftWinRate;
    }
    return left.playerName.localeCompare(right.playerName);
  };

  const rankable = withAnalytics
    .filter((entry) => entry.analytics.gamesPlayed > 0)
    .sort(compareRankableEntries);

  rankable.forEach((entry, index) => {
    entry.analytics.overallRank = index + 1;
  });

  const rankableByRole = new Map<string, ((typeof withAnalytics)[number])[]>();
  for (const entry of rankable) {
    const roleKey = normalizeForKey(entry.playerRole);
    if (!roleKey || roleKey === "unassigned") {
      continue;
    }
    const bucket = rankableByRole.get(roleKey) ?? [];
    bucket.push(entry);
    rankableByRole.set(roleKey, bucket);
  }
  for (const bucket of rankableByRole.values()) {
    bucket.sort(compareRankableEntries);
    bucket.forEach((entry, index) => {
      entry.analytics.positionRank = index + 1;
    });
  }

  const analyticsByPlayerKey = new Map<string, DraftPlayerAnalytics>();
  for (const entry of withAnalytics) {
    analyticsByPlayerKey.set(entry.key, entry.analytics);
  }

  draftPlayerAnalyticsCache.set(cacheKey, {
    cachedAtMs: nowMs,
    analyticsByPlayerKey,
  });

  return analyticsByPlayerKey;
};

const addAnalyticsToPlayerPool = async ({
  sourcePage,
  playerPool,
}: {
  sourcePage: string;
  playerPool: DraftPlayerPoolEntry[];
}): Promise<DraftPlayerPoolEntry[]> => {
  const analyticsByPlayerKey = await buildPlayerAnalyticsByPool({
    sourcePage,
    playerPool,
  });

  return playerPool.map((entry) => ({
    ...entry,
    analytics: analyticsByPlayerKey.get(draftPoolPlayerKey(entry)) ?? createEmptyAnalytics(),
  }));
};

type DraftRow = {
  id: number;
  name: string;
  league_slug: string;
  season_year: number;
  source_page: string;
  scheduled_at: string;
  started_at: string | null;
  round_count: number;
  pick_seconds: number;
  status: DraftStatus;
  created_by_user_id: string;
  created_by_label: string | null;
  created_at: string;
};

type DraftParticipantRow = {
  id: number;
  draft_id: number;
  user_id: string;
  email: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  team_name: string | null;
  draft_position: number;
  created_at: string;
};

type DraftPickRow = {
  id: number;
  draft_id: number;
  overall_pick: number;
  round_number: number;
  round_pick: number;
  participant_user_id: string;
  participant_display_name: string;
  team_name: string;
  player_team: string | null;
  player_role: string | null;
  team_icon_url: string | null;
  player_image_url: string | null;
  picked_by_user_id: string;
  picked_by_label: string | null;
  picked_at: string;
};

type DraftTeamPoolRow = {
  id: number;
  draft_id: number;
  team_name: string;
  player_team: string | null;
  player_role: string | null;
  team_icon_url: string | null;
  player_image_url: string | null;
  source_page: string;
  created_at: string;
};

type DraftPresenceRow = {
  draft_id: number;
  user_id: string;
  is_ready: boolean;
  last_seen_at: string | null;
  updated_at: string;
};

type ParticipantDraftIdRow = {
  draft_id: number;
};

const toDraftSummary = (
  row: DraftRow,
  participantCount: number,
  pickCount: number,
): DraftSummary => {
  const effectiveRoundCount = Math.min(Math.max(1, row.round_count), MAX_ROSTER_PLAYERS);
  return {
    id: row.id,
    name: row.name,
    leagueSlug: row.league_slug,
    seasonYear: row.season_year,
    sourcePage: row.source_page,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    roundCount: effectiveRoundCount,
    pickSeconds: row.pick_seconds,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    createdByLabel: formatUserLabelFromDisplayName(row.created_by_label) ?? row.created_by_label,
    participantCount,
    pickCount,
    totalPickCount: participantCount * effectiveRoundCount,
    createdAt: row.created_at,
  };
};

const toParticipant = (row: DraftParticipantRow): DraftParticipant => ({
  id: row.id,
  draftId: row.draft_id,
  userId: row.user_id,
  email: row.email,
  displayName: formatUserLabelFromDisplayName(row.display_name) ?? row.display_name,
  firstName: row.first_name,
  lastName: row.last_name,
  teamName: row.team_name,
  draftPosition: row.draft_position,
  createdAt: row.created_at,
});

const toPick = (row: DraftPickRow): DraftPick => ({
  id: row.id,
  draftId: row.draft_id,
  overallPick: row.overall_pick,
  roundNumber: row.round_number,
  roundPick: row.round_pick,
  participantUserId: row.participant_user_id,
  participantDisplayName:
    formatUserLabelFromDisplayName(row.participant_display_name) ?? row.participant_display_name,
  playerName: row.team_name,
  playerImageUrl: row.player_image_url ?? null,
  playerTeam: row.player_team,
  playerRole: row.player_role,
  teamIconUrl: row.team_icon_url,
  pickedByUserId: row.picked_by_user_id,
  pickedByLabel: row.picked_by_label,
  pickedAt: row.picked_at,
});

const toPlayerPool = (row: DraftTeamPoolRow): DraftPlayerPoolEntry => ({
  id: row.id,
  draftId: row.draft_id,
  playerName: row.team_name,
  playerImageUrl: row.player_image_url ?? null,
  playerTeam: row.player_team,
  playerRole: row.player_role,
  teamIconUrl: row.team_icon_url,
  sourcePage: row.source_page,
  createdAt: row.created_at,
});

const mapRegisteredUser = (user: User): RegisteredUser => ({
  userId: user.id,
  email: user.email ?? null,
  displayName: getUserDisplayName(user) ?? user.id,
  firstName: getUserFirstName(user),
  lastName: getUserLastName(user),
  teamName: getUserTeamName(user),
});

export const listRegisteredUsers = async (): Promise<RegisteredUser[]> => {
  const supabase = getSupabaseServerClient();
  const users: User[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) {
      throw new Error(`Unable to list registered users: ${error.message}`);
    }

    users.push(...data.users);
    if (data.users.length < perPage) {
      break;
    }
    page += 1;
    if (page > 50) {
      break;
    }
  }

  return users
    .map(mapRegisteredUser)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
};

const fetchDraftRows = async (draftIds?: number[]): Promise<DraftRow[]> => {
  if (draftIds && draftIds.length === 0) {
    return [];
  }

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from(DRAFTS_TABLE)
    .select("*")
    .order("scheduled_at", { ascending: false })
    .order("id", { ascending: false });

  if (draftIds && draftIds.length > 0) {
    query = query.in("id", draftIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load drafts: ${error.message}`);
  }

  return (data ?? []) as DraftRow[];
};

const fetchParticipantCounts = async (draftIds?: number[]): Promise<Map<number, number>> => {
  if (draftIds && draftIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from(PARTICIPANTS_TABLE)
    .select("draft_id");

  if (draftIds && draftIds.length > 0) {
    query = query.in("draft_id", draftIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load draft participants: ${error.message}`);
  }

  const counts = new Map<number, number>();
  for (const row of (data ?? []) as { draft_id: number }[]) {
    counts.set(row.draft_id, (counts.get(row.draft_id) ?? 0) + 1);
  }
  return counts;
};

const fetchPickCounts = async (draftIds?: number[]): Promise<Map<number, number>> => {
  if (draftIds && draftIds.length === 0) {
    return new Map();
  }

  const supabase = getSupabaseServerClient();
  let query = supabase
    .from(PICKS_TABLE)
    .select("draft_id");

  if (draftIds && draftIds.length > 0) {
    query = query.in("draft_id", draftIds);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Unable to load draft picks: ${error.message}`);
  }

  const counts = new Map<number, number>();
  for (const row of (data ?? []) as { draft_id: number }[]) {
    counts.set(row.draft_id, (counts.get(row.draft_id) ?? 0) + 1);
  }
  return counts;
};

export const listDraftSummaries = async (): Promise<DraftSummary[]> => {
  const [draftRows, participantCounts, pickCounts] = await Promise.all([
    fetchDraftRows(),
    fetchParticipantCounts(),
    fetchPickCounts(),
  ]);

  return draftRows.map((row) =>
    toDraftSummary(
      row,
      participantCounts.get(row.id) ?? 0,
      pickCounts.get(row.id) ?? 0,
    )
  );
};

const draftStatusOrder: Record<DraftStatus, number> = {
  live: 0,
  paused: 1,
  scheduled: 2,
  completed: 3,
};

export const listDraftSummariesForUser = async ({
  userId,
  includeCompleted = false,
}: {
  userId: string;
  includeCompleted?: boolean;
}): Promise<DraftSummary[]> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(PARTICIPANTS_TABLE)
    .select("draft_id")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Unable to load user draft memberships: ${error.message}`);
  }

  const draftIds = [...new Set(
    ((data ?? []) as ParticipantDraftIdRow[])
      .map((entry) => entry.draft_id)
      .filter((entry) => Number.isFinite(entry) && entry > 0),
  )];

  if (draftIds.length === 0) {
    return [];
  }

  const [draftRows, participantCounts, pickCounts] = await Promise.all([
    fetchDraftRows(draftIds),
    fetchParticipantCounts(draftIds),
    fetchPickCounts(draftIds),
  ]);

  const summaries = draftRows.map((row) =>
    toDraftSummary(
      row,
      participantCounts.get(row.id) ?? 0,
      pickCounts.get(row.id) ?? 0,
    )
  );

  const filtered = includeCompleted
    ? summaries
    : summaries.filter((entry) => entry.status !== "completed");

  return filtered.sort((a, b) => {
    const statusDiff = draftStatusOrder[a.status] - draftStatusOrder[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    const scheduledDiff = new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    if (scheduledDiff !== 0) {
      return scheduledDiff;
    }

    return b.id - a.id;
  });
};

const loadParticipants = async (draftId: number): Promise<DraftParticipant[]> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(PARTICIPANTS_TABLE)
    .select("*")
    .eq("draft_id", draftId)
    .order("draft_position", { ascending: true });

  if (error) {
    throw new Error(`Unable to load participants: ${error.message}`);
  }

  return ((data ?? []) as DraftParticipantRow[]).map(toParticipant);
};

const loadPicks = async (draftId: number): Promise<DraftPick[]> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(PICKS_TABLE)
    .select("*")
    .eq("draft_id", draftId)
    .order("overall_pick", { ascending: true });

  if (error) {
    throw new Error(`Unable to load draft picks: ${error.message}`);
  }

  return ((data ?? []) as DraftPickRow[]).map(toPick);
};

const loadPlayerPool = async (draftId: number): Promise<DraftPlayerPoolEntry[]> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(TEAM_POOL_TABLE)
    .select("*")
    .eq("draft_id", draftId)
    .order("team_name", { ascending: true });

  if (error) {
    throw new Error(`Unable to load player pool: ${error.message}`);
  }

  return ((data ?? []) as DraftTeamPoolRow[]).map(toPlayerPool);
};

const loadDraftRow = async (draftId: number): Promise<DraftRow> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(DRAFTS_TABLE)
    .select("*")
    .eq("id", draftId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to load draft: ${error.message}`);
  }
  if (!data) {
    throw new Error("Draft not found.");
  }

  return data as DraftRow;
};

const loadPresence = async (draftId: number): Promise<DraftPresenceRow[]> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(PRESENCE_TABLE)
    .select("*")
    .eq("draft_id", draftId);

  if (error) {
    throw new Error(`Unable to load draft presence: ${error.message}`);
  }

  return (data ?? []) as DraftPresenceRow[];
};

const buildParticipantPresence = ({
  participants,
  presenceRows,
  now,
}: {
  participants: DraftParticipant[];
  presenceRows: DraftPresenceRow[];
  now: Date;
}): DraftParticipantPresence[] => {
  const presenceByUserId = new Map(
    presenceRows.map((entry) => [entry.user_id, entry]),
  );
  const nowMs = now.getTime();

  return participants.map((participant) => {
    const presence = presenceByUserId.get(participant.userId);
    const lastSeenAt = presence?.last_seen_at ?? null;
    const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NaN;
    const isOnline = Number.isFinite(lastSeenMs) && nowMs - lastSeenMs <= ONLINE_HEARTBEAT_WINDOW_MS;
    return {
      userId: participant.userId,
      displayName: participant.displayName,
      isReady: presence?.is_ready ?? false,
      lastSeenAt,
      isOnline,
    };
  });
};

export const getDraftDetail = async ({
  draftId,
  currentUserId,
}: {
  draftId: number;
  currentUserId: string;
}): Promise<DraftDetail> => {
  const [draftRow, participants, picks, basePlayerPool, presenceRows, isGlobalAdmin] = await Promise.all([
    loadDraftRow(draftId),
    loadParticipants(draftId),
    loadPicks(draftId),
    loadPlayerPool(draftId),
    loadPresence(draftId),
    isGlobalAdminUser({ userId: currentUserId }),
  ]);

  const serverNow = new Date();
  const summary = toDraftSummary(draftRow, participants.length, picks.length);
  const playerPoolWithPortraits = await withResolvedDraftPlayerImages(basePlayerPool);
  const playerPool = await addAnalyticsToPlayerPool({
    sourcePage: summary.sourcePage,
    playerPool: playerPoolWithPortraits,
  });
  const pickedPlayers = new Set(picks.map((pick) => pick.playerName));
  const availablePlayers = playerPool.filter((player) => !pickedPlayers.has(player.playerName));
  const participantPresence = buildParticipantPresence({
    participants,
    presenceRows,
    now: serverNow,
  });
  const presentParticipantCount = participantPresence.filter((entry) => entry.isOnline).length;
  const readyParticipantCount = participantPresence.filter((entry) => entry.isReady).length;
  const allParticipantsPresent = participants.length > 0 && presentParticipantCount === participants.length;
  const allParticipantsReady = participants.length > 0 && readyParticipantCount === participants.length;

  return {
    ...summary,
    participants,
    picks,
    playerPool,
    availablePlayers,
    nextPick: resolveNextPick({
      participants,
      picks,
      roundCount: summary.roundCount,
    }),
    currentPickDeadlineAt: resolveCurrentPickDeadline({
      pickSeconds: summary.pickSeconds,
      status: summary.status,
      startedAt: summary.startedAt,
      picks,
    }),
    isCommissioner: summary.createdByUserId === currentUserId || isGlobalAdmin,
    serverNow: serverNow.toISOString(),
    participantPresence,
    presentParticipantCount,
    readyParticipantCount,
    allParticipantsPresent,
    allParticipantsReady,
  };
};

export const upsertDraftPresence = async ({
  draftId,
  userId,
  isReady,
}: {
  draftId: number;
  userId: string;
  isReady?: boolean;
}): Promise<void> => {
  const supabase = getSupabaseServerClient();
  const nowIso = new Date().toISOString();

  const upsert: Record<string, unknown> = {
    draft_id: draftId,
    user_id: userId,
    last_seen_at: nowIso,
    updated_at: nowIso,
  };
  if (typeof isReady === "boolean") {
    upsert.is_ready = isReady;
  }

  const { error } = await supabase
    .from(PRESENCE_TABLE)
    .upsert(upsert, { onConflict: "draft_id,user_id" });

  if (error) {
    throw new Error(`Unable to update draft presence: ${error.message}`);
  }
};

export const ensureDraftParticipant = ({
  participants,
  userId,
}: {
  participants: DraftParticipant[];
  userId: string;
}): DraftParticipant | null =>
  participants.find((entry) => entry.userId === userId) ?? null;

export const resolveOnClockParticipant = ({
  participants,
  picks,
}: {
  participants: DraftParticipant[];
  picks: DraftPick[];
}): DraftParticipant => {
  const slot = getPickSlot(participants.length, picks.length + 1);
  const participant = participants[slot.participantIndex];
  if (!participant) {
    throw new Error("Unable to determine on-clock participant.");
  }
  return participant;
};
