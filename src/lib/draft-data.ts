import type { User } from "@supabase/supabase-js";
import { isGlobalAdminUser } from "@/lib/admin-access";
import { getPickSlot, resolveCurrentPickDeadline, resolveNextPick } from "@/lib/draft-engine";
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
  DraftParticipant,
  DraftParticipantPresence,
  DraftPlayerPoolEntry,
  DraftPick,
  DraftStatus,
  DraftSummary,
  RegisteredUser,
} from "@/types/draft";

const DRAFTS_TABLE = "fantasy_drafts";
const PARTICIPANTS_TABLE = "fantasy_draft_participants";
const PICKS_TABLE = "fantasy_draft_picks";
const TEAM_POOL_TABLE = "fantasy_draft_team_pool";
const PRESENCE_TABLE = "fantasy_draft_presence";
const ONLINE_HEARTBEAT_WINDOW_MS = 45_000;
const MAX_ROSTER_PLAYERS = 5;

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
  const [draftRow, participants, picks, playerPool, presenceRows, isGlobalAdmin] = await Promise.all([
    loadDraftRow(draftId),
    loadParticipants(draftId),
    loadPicks(draftId),
    loadPlayerPool(draftId),
    loadPresence(draftId),
    isGlobalAdminUser({ userId: currentUserId }),
  ]);

  const serverNow = new Date();
  const summary = toDraftSummary(draftRow, participants.length, picks.length);
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
