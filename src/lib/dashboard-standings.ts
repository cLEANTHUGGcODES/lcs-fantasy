import type { User } from "@supabase/supabase-js";
import { aggregatePlayerTotals } from "@/lib/fantasy";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getUserAvatarUrl, getUserDisplayName, getUserTeamName } from "@/lib/user-profile";
import type { ParsedGame, PlayerTotal } from "@/types/fantasy";

const DAY_MS = 24 * 60 * 60 * 1000;
const BYE_USER_ID = "__BYE__";

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
  team_icon_url: string | null;
};

type DraftParticipantRow = {
  user_id: string;
  display_name: string;
  team_name: string | null;
  draft_position: number;
};

type RegisteredUserProfile = {
  userId: string;
  email: string | null;
  displayName: string;
  teamName: string | null;
  avatarUrl: string | null;
};

type HeadToHeadParticipantProfile = {
  userId: string;
  displayName: string;
  teamName: string | null;
  avatarUrl: string | null;
};

type RoundRobinPair = [string, string];

type WeeklyMatchupContext = {
  weekNumber: number;
  status: HeadToHeadWeekStatus;
  startsOn: string;
  endsOn: string;
};

type HeadToHeadRecord = {
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  pointsFor: number;
};

type WeeklyFantasyPointsResult = {
  hasGames: boolean;
  pointsByUser: Map<string, number>;
};

export type DashboardStandingBreakdown = {
  playerName: string;
  playerTeam: string | null;
  playerRole: string | null;
  playerTeamIconUrl: string | null;
  points: number;
  games: number;
};

export type DashboardStandingRow = {
  userId: string;
  displayName: string;
  teamName: string | null;
  email: string | null;
  avatarUrl: string | null;
  drafted: boolean;
  totalPoints: number;
  averagePerPick: number;
  breakdown: DashboardStandingBreakdown[];
};

export type HeadToHeadWeekStatus =
  | "active"
  | "upcoming"
  | "finalized"
  | "offseason";

export type HeadToHeadMatchupSide = {
  userId: string;
  displayName: string;
  teamName: string | null;
  avatarUrl: string | null;
  weekPoints: number;
};

export type HeadToHeadMatchup = {
  matchupKey: string;
  weekNumber: number;
  startsOn: string;
  endsOn: string;
  status: HeadToHeadWeekStatus;
  left: HeadToHeadMatchupSide;
  right: HeadToHeadMatchupSide | null;
  winnerUserId: string | null;
  isTie: boolean;
};

export type HeadToHeadWeekView = {
  weekNumber: number;
  status: HeadToHeadWeekStatus;
  startsOn: string;
  endsOn: string;
  hasGames: boolean;
  matchups: HeadToHeadMatchup[];
};

export type HeadToHeadStandingRow = {
  rank: number;
  userId: string;
  displayName: string;
  teamName: string | null;
  avatarUrl: string | null;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  winPct: number;
  pointsFor: number;
};

export type HeadToHeadSummary = {
  enabled: boolean;
  currentWeekNumber: number | null;
  weekNumber: number | null;
  weekStatus: HeadToHeadWeekStatus;
  weekStartsOn: string | null;
  weekEndsOn: string | null;
  canViewPreviousWeek: boolean;
  previousWeekNumber: number | null;
  cycleLength: number;
  finalizedWeekCount: number;
  standings: HeadToHeadStandingRow[];
  matchups: HeadToHeadMatchup[];
  weeks: HeadToHeadWeekView[];
};

export type DashboardStandings = {
  completedDraftId: number | null;
  completedDraftName: string | null;
  completedDraftAt: string | null;
  rows: DashboardStandingRow[];
  headToHead: HeadToHeadSummary;
};

const normalizeName = (value: string): string => value.trim().toLowerCase();
const normalizeTeam = (value: string): string => value.trim().toLowerCase();
const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const padTwo = (value: number): string => `${value}`.padStart(2, "0");

const emptyHeadToHeadSummary = (): HeadToHeadSummary => ({
  enabled: false,
  currentWeekNumber: null,
  weekNumber: null,
  weekStatus: "offseason",
  weekStartsOn: null,
  weekEndsOn: null,
  canViewPreviousWeek: false,
  previousWeekNumber: null,
  cycleLength: 0,
  finalizedWeekCount: 0,
  standings: [],
  matchups: [],
  weeks: [],
});

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

const toDateKeyUtc = (value: Date): string =>
  `${value.getUTCFullYear()}-${padTwo(value.getUTCMonth() + 1)}-${padTwo(value.getUTCDate())}`;

const parseDateKeyUtc = (value: string): Date | null => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const addDaysToDateKey = (dateKey: string, days: number): string => {
  const parsed = parseDateKeyUtc(dateKey);
  if (!parsed) {
    return dateKey;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toDateKeyUtc(parsed);
};

const dateKeyDayIndex = (value: string): number => {
  const parsed = parseDateKeyUtc(value);
  if (!parsed) {
    return 0;
  }
  return Math.floor(parsed.getTime() / DAY_MS);
};

const wednesdayOnOrBefore = (dateKey: string): string => {
  const parsed = parseDateKeyUtc(dateKey);
  if (!parsed) {
    return dateKey;
  }

  while (parsed.getUTCDay() !== 3) {
    parsed.setUTCDate(parsed.getUTCDate() - 1);
  }

  return toDateKeyUtc(parsed);
};

const getWeekBounds = (
  weekOneStartKey: string,
  weekNumber: number,
): { startsOn: string; endsOn: string } => {
  const offset = Math.max(0, weekNumber - 1) * 7;
  const startsOn = addDaysToDateKey(weekOneStartKey, offset);
  const endsOn = addDaysToDateKey(startsOn, 5);
  return { startsOn, endsOn };
};

const resolveCurrentWeekContext = (
  weekOneStartKey: string,
  todayKey: string,
): WeeklyMatchupContext => {
  const weekOneDay = dateKeyDayIndex(weekOneStartKey);
  const todayDay = dateKeyDayIndex(todayKey);

  if (todayDay < weekOneDay) {
    const initialBounds = getWeekBounds(weekOneStartKey, 1);
    return {
      weekNumber: 1,
      status: "upcoming",
      startsOn: initialBounds.startsOn,
      endsOn: initialBounds.endsOn,
    };
  }

  const daysSinceWeekOne = todayDay - weekOneDay;
  const weekOffset = Math.floor(daysSinceWeekOne / 7);
  const dayWithinCycle = daysSinceWeekOne % 7;
  const activeWeekNumber = weekOffset + 1;

  if (dayWithinCycle <= 5) {
    const bounds = getWeekBounds(weekOneStartKey, activeWeekNumber);
    return {
      weekNumber: activeWeekNumber,
      status: "active",
      startsOn: bounds.startsOn,
      endsOn: bounds.endsOn,
    };
  }

  const upcomingWeekNumber = activeWeekNumber + 1;
  const upcomingBounds = getWeekBounds(weekOneStartKey, upcomingWeekNumber);
  return {
    weekNumber: upcomingWeekNumber,
    status: "upcoming",
    startsOn: upcomingBounds.startsOn,
    endsOn: upcomingBounds.endsOn,
  };
};

const countFinalizedWeeks = (weekOneStartKey: string, todayKey: string): number => {
  let count = 0;
  let week = 1;

  while (week < 500) {
    const { endsOn } = getWeekBounds(weekOneStartKey, week);
    if (endsOn >= todayKey) {
      break;
    }

    count += 1;
    week += 1;
  }

  return count;
};

const extractGameDateKey = (game: ParsedGame): string | null => {
  if (game.playedAtLabel) {
    const labelMatch = game.playedAtLabel.match(/^(\d{4}-\d{2}-\d{2})/);
    if (labelMatch) {
      return labelMatch[1];
    }
  }

  if (game.playedAtRaw) {
    const parts = game.playedAtRaw
      .split(",")
      .map((entry) => Number.parseInt(entry.trim(), 10));

    if (
      parts.length >= 3 &&
      Number.isFinite(parts[0]) &&
      Number.isFinite(parts[1]) &&
      Number.isFinite(parts[2]) &&
      parts[1] >= 1 &&
      parts[1] <= 12 &&
      parts[2] >= 1 &&
      parts[2] <= 31
    ) {
      return `${parts[0]}-${padTwo(parts[1])}-${padTwo(parts[2])}`;
    }
  }

  return null;
};

const findEarliestGameDateKey = (games: ParsedGame[]): string | null => {
  let earliest: string | null = null;

  for (const game of games) {
    const dateKey = extractGameDateKey(game);
    if (!dateKey) {
      continue;
    }

    if (!earliest || dateKey < earliest) {
      earliest = dateKey;
    }
  }

  return earliest;
};

const buildRoundRobinRounds = (participantUserIds: string[]): RoundRobinPair[][] => {
  if (participantUserIds.length < 2) {
    return [];
  }

  const seed = [...participantUserIds];
  if (seed.length % 2 === 1) {
    seed.push(BYE_USER_ID);
  }

  const rounds: RoundRobinPair[][] = [];
  let rotation = [...seed];
  const roundCount = rotation.length - 1;
  const pairsPerRound = rotation.length / 2;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const pairs: RoundRobinPair[] = [];
    for (let pairIndex = 0; pairIndex < pairsPerRound; pairIndex += 1) {
      const left = rotation[pairIndex];
      const right = rotation[rotation.length - 1 - pairIndex];
      if (left && right) {
        pairs.push([left, right]);
      }
    }
    rounds.push(pairs);

    const anchor = rotation[0];
    const movable = rotation.slice(1);
    const tail = movable.pop();
    if (!anchor || !tail) {
      break;
    }
    rotation = [anchor, tail, ...movable];
  }

  return rounds;
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
      teamName: getUserTeamName(user),
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
    .select("participant_user_id,team_name,player_team,player_role,team_icon_url")
    .eq("draft_id", draftId)
    .order("overall_pick", { ascending: true });

  if (error) {
    throw new Error(`Unable to load draft picks: ${error.message}`);
  }

  return (data ?? []) as DraftPickRow[];
};

const loadDraftParticipants = async (
  draftId: number,
): Promise<DraftParticipantRow[]> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("fantasy_draft_participants")
    .select("user_id,display_name,team_name,draft_position")
    .eq("draft_id", draftId)
    .order("draft_position", { ascending: true });

  if (error) {
    throw new Error(`Unable to load draft participants: ${error.message}`);
  }

  return (data ?? []) as DraftParticipantRow[];
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
    byName.get(nameKey)?.push(entry);
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

const resolveWeeklyFantasyPointsByUser = ({
  weekNumber,
  weekOneStartKey,
  games,
  participantProfiles,
  picksByUserId,
}: {
  weekNumber: number;
  weekOneStartKey: string;
  games: ParsedGame[];
  participantProfiles: HeadToHeadParticipantProfile[];
  picksByUserId: Map<string, DraftPickRow[]>;
}): WeeklyFantasyPointsResult => {
  const { startsOn, endsOn } = getWeekBounds(weekOneStartKey, weekNumber);

  const weeklyGames = games.filter((game) => {
    const gameDateKey = extractGameDateKey(game);
    return gameDateKey ? gameDateKey >= startsOn && gameDateKey <= endsOn : false;
  });

  const weeklyPlayerTotals = aggregatePlayerTotals(weeklyGames);
  const { byName, byNameAndTeam } = buildPlayerTotalsLookups(weeklyPlayerTotals);
  const pointsByUser = new Map<string, number>();

  for (const participant of participantProfiles) {
    const userPicks = picksByUserId.get(participant.userId) ?? [];
    const weeklyPoints = userPicks.reduce((total, pick) => {
      const resolved = resolvePlayerTotal({ pick, byName, byNameAndTeam });
      return total + (resolved?.fantasyPoints ?? 0);
    }, 0);

    pointsByUser.set(participant.userId, round(weeklyPoints));
  }

  return {
    hasGames: weeklyGames.length > 0,
    pointsByUser,
  };
};

const buildHeadToHeadSummary = ({
  completedDraftAt,
  participants,
  picksByUserId,
  usersById,
  games,
}: {
  completedDraftAt: string;
  participants: DraftParticipantRow[];
  picksByUserId: Map<string, DraftPickRow[]>;
  usersById: Map<string, RegisteredUserProfile>;
  games: ParsedGame[];
}): HeadToHeadSummary => {
  const participantProfiles =
    participants.length > 0
      ? participants.map((participant) => {
          const matchedUser = usersById.get(participant.user_id);
          return {
            userId: participant.user_id,
            displayName:
              participant.display_name?.trim() || matchedUser?.displayName || participant.user_id,
            teamName: participant.team_name?.trim() || null,
            avatarUrl: matchedUser?.avatarUrl ?? null,
          };
        })
      : [...picksByUserId.keys()]
          .map((userId) => {
            const matchedUser = usersById.get(userId);
            return {
              userId,
              displayName: matchedUser?.displayName ?? userId,
              teamName: null,
              avatarUrl: matchedUser?.avatarUrl ?? null,
            };
          })
          .sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (participantProfiles.length < 2) {
    return emptyHeadToHeadSummary();
  }

  const rounds = buildRoundRobinRounds(
    participantProfiles.map((participant) => participant.userId),
  );
  if (rounds.length === 0) {
    return emptyHeadToHeadSummary();
  }

  const draftDate = new Date(completedDraftAt);
  const todayDate = new Date();
  const normalizedDraftDate = Number.isNaN(draftDate.getTime()) ? todayDate : draftDate;
  const draftAnchorKey = toDateKeyUtc(normalizedDraftDate);
  const earliestGameDateKey = findEarliestGameDateKey(games);
  const weekAnchorKey =
    earliestGameDateKey && earliestGameDateKey < draftAnchorKey
      ? earliestGameDateKey
      : draftAnchorKey;
  // Backfill-friendly anchor: allow prior game windows to be scored if data exists.
  const weekOneStartKey = wednesdayOnOrBefore(weekAnchorKey);
  const todayKey = toDateKeyUtc(todayDate);
  const currentWeekContext = resolveCurrentWeekContext(weekOneStartKey, todayKey);
  const finalizedWeekCount = countFinalizedWeeks(weekOneStartKey, todayKey);
  const maxWeekNumberToScore = Math.max(
    currentWeekContext.weekNumber,
    finalizedWeekCount,
    1,
  );

  const weeklyPointsByWeek = new Map<number, WeeklyFantasyPointsResult>();
  for (let weekNumber = 1; weekNumber <= maxWeekNumberToScore; weekNumber += 1) {
    weeklyPointsByWeek.set(
      weekNumber,
      resolveWeeklyFantasyPointsByUser({
        weekNumber,
        weekOneStartKey,
        games,
        participantProfiles,
        picksByUserId,
      }),
    );
  }

  const records = new Map<string, HeadToHeadRecord>();
  for (const participant of participantProfiles) {
    records.set(participant.userId, {
      wins: 0,
      losses: 0,
      ties: 0,
      gamesPlayed: 0,
      pointsFor: 0,
    });
  }

  let finalizedScoredWeekCount = 0;
  for (let weekNumber = 1; weekNumber <= finalizedWeekCount; weekNumber += 1) {
    const weeklyResult = weeklyPointsByWeek.get(weekNumber);
    if (!weeklyResult?.hasGames) {
      continue;
    }
    finalizedScoredWeekCount += 1;

    const weeklyPoints = weeklyResult.pointsByUser;

    for (const participant of participantProfiles) {
      const record = records.get(participant.userId);
      if (!record) {
        continue;
      }
      record.pointsFor = round(
        record.pointsFor + (weeklyPoints.get(participant.userId) ?? 0),
      );
    }

    const weekPairs = rounds[(weekNumber - 1) % rounds.length] ?? [];
    for (const [leftUserId, rightUserId] of weekPairs) {
      if (leftUserId === BYE_USER_ID || rightUserId === BYE_USER_ID) {
        continue;
      }

      const leftRecord = records.get(leftUserId);
      const rightRecord = records.get(rightUserId);
      if (!leftRecord || !rightRecord) {
        continue;
      }

      const leftPoints = weeklyPoints.get(leftUserId) ?? 0;
      const rightPoints = weeklyPoints.get(rightUserId) ?? 0;

      leftRecord.gamesPlayed += 1;
      rightRecord.gamesPlayed += 1;

      if (leftPoints > rightPoints) {
        leftRecord.wins += 1;
        rightRecord.losses += 1;
      } else if (rightPoints > leftPoints) {
        rightRecord.wins += 1;
        leftRecord.losses += 1;
      } else {
        leftRecord.ties += 1;
        rightRecord.ties += 1;
      }
    }
  }

  const standings = participantProfiles
    .map((participant) => {
      const record = records.get(participant.userId) ?? {
        wins: 0,
        losses: 0,
        ties: 0,
        gamesPlayed: 0,
        pointsFor: 0,
      };
      const winPct =
        record.gamesPlayed > 0
          ? (record.wins + record.ties * 0.5) / record.gamesPlayed
          : 0;

      return {
        rank: 0,
        userId: participant.userId,
        displayName: participant.displayName,
        teamName: participant.teamName,
        avatarUrl: participant.avatarUrl,
        wins: record.wins,
        losses: record.losses,
        ties: record.ties,
        gamesPlayed: record.gamesPlayed,
        winPct: round(winPct),
        pointsFor: round(record.pointsFor),
      };
    })
    .sort((a, b) => {
      if (a.winPct !== b.winPct) {
        return b.winPct - a.winPct;
      }
      if (a.pointsFor !== b.pointsFor) {
        return b.pointsFor - a.pointsFor;
      }
      return a.displayName.localeCompare(b.displayName);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  const profileByUserId = new Map(
    participantProfiles.map((participant) => [participant.userId, participant]),
  );
  const resolveWeekStatus = (weekNumber: number): HeadToHeadWeekStatus => {
    if (weekNumber < currentWeekContext.weekNumber) {
      return "finalized";
    }
    if (weekNumber === currentWeekContext.weekNumber) {
      return currentWeekContext.status;
    }
    return "upcoming";
  };

  const weeks: HeadToHeadWeekView[] = [];
  for (let weekNumber = 1; weekNumber <= maxWeekNumberToScore; weekNumber += 1) {
    const weekResult = weeklyPointsByWeek.get(weekNumber);
    const hasWeekGames = weekResult?.hasGames ?? false;
    if (!hasWeekGames && weekNumber !== currentWeekContext.weekNumber) {
      continue;
    }

    const weekPoints = weekResult?.pointsByUser ?? new Map<string, number>();
    const weekStatus = resolveWeekStatus(weekNumber);
    const weekBounds = getWeekBounds(weekOneStartKey, weekNumber);
    const weekPairs = rounds[(weekNumber - 1) % rounds.length] ?? [];
    const weekMatchups: HeadToHeadMatchup[] = [];

    for (const [leftUserId, rightUserId] of weekPairs) {
      if (leftUserId === BYE_USER_ID) {
        continue;
      }

      const leftProfile = profileByUserId.get(leftUserId);
      if (!leftProfile) {
        continue;
      }

      const rightProfile =
        rightUserId !== BYE_USER_ID ? profileByUserId.get(rightUserId) ?? null : null;
      const leftPoints = weekPoints.get(leftUserId) ?? 0;
      const rightPoints =
        rightProfile && rightUserId !== BYE_USER_ID ? weekPoints.get(rightUserId) ?? 0 : 0;
      const isTie =
        weekStatus !== "upcoming" &&
        hasWeekGames &&
        Boolean(rightProfile) &&
        leftPoints === rightPoints;
      const winnerUserId =
        weekStatus === "upcoming" || !rightProfile || !hasWeekGames || isTie
          ? null
          : leftPoints > rightPoints
            ? leftUserId
            : rightUserId;

      weekMatchups.push({
        matchupKey: `${weekNumber}:${leftUserId}:${rightUserId}`,
        weekNumber,
        startsOn: weekBounds.startsOn,
        endsOn: weekBounds.endsOn,
        status: weekStatus,
        left: {
          userId: leftProfile.userId,
          displayName: leftProfile.displayName,
          teamName: leftProfile.teamName,
          avatarUrl: leftProfile.avatarUrl,
          weekPoints: round(leftPoints),
        },
        right: rightProfile
          ? {
              userId: rightProfile.userId,
              displayName: rightProfile.displayName,
              teamName: rightProfile.teamName,
              avatarUrl: rightProfile.avatarUrl,
              weekPoints: round(rightPoints),
            }
          : null,
        winnerUserId: winnerUserId && winnerUserId !== BYE_USER_ID ? winnerUserId : null,
        isTie,
      });
    }

    weeks.push({
      weekNumber,
      status: weekStatus,
      startsOn: weekBounds.startsOn,
      endsOn: weekBounds.endsOn,
      hasGames: hasWeekGames,
      matchups: weekMatchups,
    });
  }

  if (weeks.length === 0) {
    const fallbackBounds = getWeekBounds(weekOneStartKey, currentWeekContext.weekNumber);
    weeks.push({
      weekNumber: currentWeekContext.weekNumber,
      status: currentWeekContext.status,
      startsOn: fallbackBounds.startsOn,
      endsOn: fallbackBounds.endsOn,
      hasGames: false,
      matchups: [],
    });
  }

  const selectedWeek =
    weeks.find((entry) => entry.weekNumber === currentWeekContext.weekNumber) ??
    weeks[weeks.length - 1];
  const selectedWeekIndex = weeks.findIndex(
    (entry) => entry.weekNumber === selectedWeek.weekNumber,
  );
  const previousWeekNumber =
    selectedWeekIndex > 0 ? (weeks[selectedWeekIndex - 1]?.weekNumber ?? null) : null;

  return {
    enabled: true,
    currentWeekNumber: currentWeekContext.weekNumber,
    weekNumber: selectedWeek.weekNumber,
    weekStatus: selectedWeek.status,
    weekStartsOn: selectedWeek.startsOn,
    weekEndsOn: selectedWeek.endsOn,
    canViewPreviousWeek: previousWeekNumber !== null,
    previousWeekNumber,
    cycleLength: rounds.length,
    finalizedWeekCount: finalizedScoredWeekCount,
    standings,
    matchups: selectedWeek.matchups,
    weeks,
  };
};

export const getDashboardStandings = async ({
  playerTotals,
  games,
}: {
  playerTotals: PlayerTotal[];
  games: ParsedGame[];
}): Promise<DashboardStandings> => {
  const users = await listRegisteredUserProfiles();
  const usersById = new Map(users.map((user) => [user.userId, user]));
  const latestCompletedDraft = await loadLatestCompletedDraft();

  if (!latestCompletedDraft) {
    return {
      completedDraftId: null,
      completedDraftName: null,
      completedDraftAt: null,
      rows: users.map((user) => ({
        userId: user.userId,
        displayName: user.displayName,
        teamName: user.teamName,
        email: user.email,
        avatarUrl: user.avatarUrl,
        drafted: false,
        totalPoints: 0,
        averagePerPick: 0,
        breakdown: [],
      })),
      headToHead: emptyHeadToHeadSummary(),
    };
  }

  const [picks, participants] = await Promise.all([
    loadDraftPicks(latestCompletedDraft.id),
    loadDraftParticipants(latestCompletedDraft.id),
  ]);
  const participantTeamNameByUserId = new Map(
    participants.map((participant) => [
      participant.user_id,
      participant.team_name?.trim() || null,
    ]),
  );

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
        playerTeam: resolved?.team ?? pick.player_team,
        playerRole: pick.player_role,
        playerTeamIconUrl: pick.team_icon_url,
        points: resolved?.fantasyPoints ?? 0,
        games: resolved?.games ?? 0,
      };
    });

    const totalPoints = breakdown.reduce((total, entry) => total + entry.points, 0);
    const averagePerPick = breakdown.length > 0 ? totalPoints / breakdown.length : 0;

    return {
      userId: user.userId,
      displayName: user.displayName,
      teamName: participantTeamNameByUserId.get(user.userId) ?? user.teamName,
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
    headToHead: buildHeadToHeadSummary({
      completedDraftAt:
        latestCompletedDraft.started_at ?? latestCompletedDraft.scheduled_at,
      participants,
      picksByUserId,
      usersById,
      games,
    }),
  };
};
