import type { User } from "@supabase/supabase-js";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getUserAvatarUrl, getUserDisplayName } from "@/lib/user-profile";
import type { PlayerTotal } from "@/types/fantasy";

type CompletedDraftRow = {
  id: number;
  name: string;
  started_at: string | null;
  scheduled_at: string;
};

type DraftPickRow = {
  participant_user_id: string;
  team_name: string;
  player_team: string | null;
  player_role: string | null;
};

type RegisteredUserProfile = {
  userId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
};

export type DashboardStandingBreakdown = {
  playerName: string;
  playerTeam: string | null;
  playerRole: string | null;
  points: number;
  games: number;
};

export type DashboardStandingRow = {
  userId: string;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  drafted: boolean;
  totalPoints: number;
  averagePerPick: number;
  breakdown: DashboardStandingBreakdown[];
};

export type DashboardStandings = {
  completedDraftId: number | null;
  completedDraftName: string | null;
  completedDraftAt: string | null;
  rows: DashboardStandingRow[];
};

const normalizeName = (value: string): string => value.trim().toLowerCase();
const normalizeTeam = (value: string): string => value.trim().toLowerCase();

const stripTeamSuffixFromName = (name: string, team: string | null): string => {
  const normalized = name.trim();
  if (!team) {
    return normalized;
  }

  const suffix = ` (${team.trim()})`;
  if (normalized.endsWith(suffix)) {
    return normalized.slice(0, -suffix.length).trim();
  }
  return normalized;
};

const listRegisteredUserProfiles = async (): Promise<RegisteredUserProfile[]> => {
  const supabase = getSupabaseServerClient();
  const { supabaseUrl } = getSupabaseAuthEnv();
  const users: User[] = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Unable to list registered users: ${error.message}`);
    }

    users.push(...data.users);
    if (data.users.length < perPage || page >= 50) {
      break;
    }
    page += 1;
  }

  return users
    .map((user) => ({
      userId: user.id,
      email: user.email ?? null,
      displayName: getUserDisplayName(user) ?? user.id,
      avatarUrl: getUserAvatarUrl({ user, supabaseUrl }),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
};

const loadLatestCompletedDraft = async (): Promise<CompletedDraftRow | null> => {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("fantasy_drafts")
    .select("id,name,started_at,scheduled_at")
    .eq("status", "completed")
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("scheduled_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<CompletedDraftRow>();

  if (error) {
    throw new Error(`Unable to load completed draft: ${error.message}`);
  }
  return data ?? null;
};

const loadDraftPicks = async (draftId: number): Promise<DraftPickRow[]> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("fantasy_draft_picks")
    .select("participant_user_id,team_name,player_team,player_role")
    .eq("draft_id", draftId)
    .order("overall_pick", { ascending: true });

  if (error) {
    throw new Error(`Unable to load draft picks: ${error.message}`);
  }

  return (data ?? []) as DraftPickRow[];
};

const buildPlayerTotalsLookups = (playerTotals: PlayerTotal[]) => {
  const byName = new Map<string, PlayerTotal[]>();
  const byNameAndTeam = new Map<string, PlayerTotal>();

  for (const entry of playerTotals) {
    const nameKey = normalizeName(entry.player);
    const teamKey = normalizeTeam(entry.team);
    const compositeKey = `${nameKey}::${teamKey}`;

    if (!byName.has(nameKey)) {
      byName.set(nameKey, []);
    }
    byName.get(nameKey)!.push(entry);
    if (!byNameAndTeam.has(compositeKey)) {
      byNameAndTeam.set(compositeKey, entry);
    }
  }

  return { byName, byNameAndTeam };
};

const resolvePlayerTotal = ({
  pick,
  byName,
  byNameAndTeam,
}: {
  pick: DraftPickRow;
  byName: Map<string, PlayerTotal[]>;
  byNameAndTeam: Map<string, PlayerTotal>;
}): PlayerTotal | null => {
  const baseName = stripTeamSuffixFromName(pick.team_name, pick.player_team);
  const nameKey = normalizeName(baseName);

  if (pick.player_team) {
    const teamKey = normalizeTeam(pick.player_team);
    const compositeKey = `${nameKey}::${teamKey}`;
    const exact = byNameAndTeam.get(compositeKey);
    if (exact) {
      return exact;
    }
  }

  const candidates = byName.get(nameKey) ?? [];
  if (candidates.length === 1) {
    return candidates[0];
  }

  return null;
};

export const getDashboardStandings = async ({
  playerTotals,
}: {
  playerTotals: PlayerTotal[];
}): Promise<DashboardStandings> => {
  const users = await listRegisteredUserProfiles();
  const latestCompletedDraft = await loadLatestCompletedDraft();

  if (!latestCompletedDraft) {
    return {
      completedDraftId: null,
      completedDraftName: null,
      completedDraftAt: null,
      rows: users.map((user) => ({
        userId: user.userId,
        displayName: user.displayName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        drafted: false,
        totalPoints: 0,
        averagePerPick: 0,
        breakdown: [],
      })),
    };
  }

  const picks = await loadDraftPicks(latestCompletedDraft.id);
  const picksByUserId = new Map<string, DraftPickRow[]>();
  for (const pick of picks) {
    const list = picksByUserId.get(pick.participant_user_id) ?? [];
    list.push(pick);
    picksByUserId.set(pick.participant_user_id, list);
  }

  const { byName, byNameAndTeam } = buildPlayerTotalsLookups(playerTotals);

  const rows: DashboardStandingRow[] = users.map((user) => {
    const userPicks = picksByUserId.get(user.userId) ?? [];
    const breakdown = userPicks.map((pick) => {
      const resolved = resolvePlayerTotal({ pick, byName, byNameAndTeam });
      return {
        playerName: pick.team_name,
        playerTeam: pick.player_team,
        playerRole: pick.player_role,
        points: resolved?.fantasyPoints ?? 0,
        games: resolved?.games ?? 0,
      };
    });

    const totalPoints = breakdown.reduce((total, entry) => total + entry.points, 0);
    const averagePerPick = breakdown.length > 0 ? totalPoints / breakdown.length : 0;

    return {
      userId: user.userId,
      displayName: user.displayName,
      email: user.email,
      avatarUrl: user.avatarUrl,
      drafted: breakdown.length > 0,
      totalPoints,
      averagePerPick,
      breakdown,
    };
  });

  rows.sort((a, b) => {
    if (a.drafted !== b.drafted) {
      return a.drafted ? -1 : 1;
    }
    if (a.totalPoints !== b.totalPoints) {
      return b.totalPoints - a.totalPoints;
    }
    return a.displayName.localeCompare(b.displayName);
  });

  return {
    completedDraftId: latestCompletedDraft.id,
    completedDraftName: latestCompletedDraft.name,
    completedDraftAt: latestCompletedDraft.started_at ?? latestCompletedDraft.scheduled_at,
    rows,
  };
};
