import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Code } from "@heroui/code";
import { Divider } from "@heroui/divider";
import { Link } from "@heroui/link";
import { Navbar, NavbarBrand, NavbarContent, NavbarItem } from "@heroui/navbar";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Crown } from "lucide-react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { AccountWidget } from "@/components/auth/account-widget";
import { GlobalChatPanel } from "@/components/chat/global-chat-panel";
import { CroppedTeamLogo } from "@/components/cropped-team-logo";
import { UserDraftRoomAccess } from "@/components/drafts/user-draft-room-access";
import { WeeklyMatchupsPanel } from "@/components/matchups/weekly-matchups-panel";
import { ScoringMethodologyDrawer } from "@/components/scoring-methodology-drawer";
import { RosterBreakdownStack } from "@/components/standings/roster-breakdown-stack";
import { isGlobalAdminUser } from "@/lib/admin-access";
import {
  getDashboardStandings,
  type HeadToHeadMatchupRosterEntry,
} from "@/lib/dashboard-standings";
import { listDraftSummariesForUser } from "@/lib/draft-data";
import { getFantasySnapshot } from "@/lib/get-fantasy-snapshot";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import {
  getUserAvatarBorderColor,
  getUserAvatarPath,
  getUserAvatarUrl,
  getUserDisplayName,
  getUserFirstName,
  getUserLastName,
  getUserTeamName,
} from "@/lib/user-profile";
import type { ParsedGame } from "@/types/fantasy";

export const dynamic = "force-dynamic";

const pointFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const sourceLinkForPage = (page: string): string =>
  `https://lol.fandom.com/wiki/${page.replace(/\s+/g, "_")}`;

const formatKda = (kills: number, deaths: number, assists: number): string =>
  `${kills}/${deaths}/${assists}`;

const formatRecord = (wins: number, games: number): string => `${wins}-${games - wins}`;

const formatPoints = (value: number): string => pointFormat.format(value);

const formatShortDate = (value: string | null): string => {
  if (!value) {
    return "Unknown date";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Unknown date";
  }

  return parsed.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
};

const formatHeadToHeadRecord = (
  wins: number,
  losses: number,
  ties: number,
): string => (ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`);

const formatWinPct = (value: number): string => value.toFixed(3);
const formatMatchupLabel = (value: string | null | undefined): string =>
  (value?.trim() || "Unknown").toUpperCase();
const formatWeekStatusLabel = (status: "active" | "upcoming" | "finalized" | "offseason"): string => {
  if (status === "active") {
    return "Live Week";
  }
  if (status === "upcoming") {
    return "Upcoming Week";
  }
  if (status === "finalized") {
    return "Finalized Week";
  }
  return "Offseason";
};
const weekStatusChipColor = (
  status: "active" | "upcoming" | "finalized" | "offseason",
): "success" | "warning" | "primary" | "default" => {
  if (status === "active") {
    return "success";
  }
  if (status === "upcoming") {
    return "warning";
  }
  if (status === "finalized") {
    return "primary";
  }
  return "default";
};

const normalizeRoleLabel = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "top") {
    return "TOP";
  }
  if (normalized === "jungle" || normalized === "jg" || normalized === "jng") {
    return "JNG";
  }
  if (normalized === "mid" || normalized === "middle") {
    return "MID";
  }
  if (
    normalized === "adc" ||
    normalized === "adcarry" ||
    normalized === "ad carry" ||
    normalized === "bot" ||
    normalized === "bottom"
  ) {
    return "ADC";
  }
  if (normalized === "support" || normalized === "sup" || normalized === "supp") {
    return "SUP";
  }
  if (normalized === "flex") {
    return "FLEX";
  }
  return null;
};
const MATCHUP_ROLE_ICON_URLS: Record<string, string> = {
  TOP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/4/44/Toprole_icon.png/revision/latest",
  JNG: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/f/fb/Junglerole_icon.png/revision/latest",
  MID: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/c/ce/Midrole_icon.png/revision/latest",
  ADC: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/d/d1/AD_Carryrole_icon.png/revision/latest",
  SUP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/7/73/Supportrole_icon.png/revision/latest",
};

const matchupRoleIconUrl = (role: string | null): string | null => {
  const normalized = normalizeRoleLabel(role);
  if (!normalized) {
    return null;
  }
  return MATCHUP_ROLE_ICON_URLS[normalized] ?? null;
};
const MATCHUP_ROLE_ORDER = ["TOP", "JNG", "MID", "ADC", "SUP", "FLEX"] as const;

const matchupRoleOrderIndex = (role: string | null): number => {
  const normalized = normalizeRoleLabel(role);
  if (!normalized) {
    return MATCHUP_ROLE_ORDER.length + 1;
  }

  const exactIndex = MATCHUP_ROLE_ORDER.indexOf(normalized as (typeof MATCHUP_ROLE_ORDER)[number]);
  if (exactIndex >= 0) {
    return exactIndex;
  }

  return MATCHUP_ROLE_ORDER.length;
};

const sortMatchupRoster = (roster: HeadToHeadMatchupRosterEntry[]): HeadToHeadMatchupRosterEntry[] =>
  [...roster].sort((left, right) => {
    const roleDiff = matchupRoleOrderIndex(left.playerRole) - matchupRoleOrderIndex(right.playerRole);
    if (roleDiff !== 0) {
      return roleDiff;
    }
    return left.playerName.localeCompare(right.playerName);
  });

const teamKey = (team: string): string => team.trim().toLowerCase();
const TABLE_BAND_CLASS =
  "[&>tbody>tr:nth-child(odd)]:bg-content2/[0.14] [&>tbody>tr:nth-child(even)]:bg-content2/[0.06] [&>tbody>tr:nth-child(odd):hover]:!bg-content2/[0.24] [&>tbody>tr:nth-child(even):hover]:!bg-content2/[0.18]";

const initialsForName = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

const buildTeamIconLookup = (games: ParsedGame[]): Map<string, string> => {
  const map = new Map<string, string>();

  for (const game of games) {
    if (game.blueTeamIconUrl && !map.has(teamKey(game.blueTeam))) {
      map.set(teamKey(game.blueTeam), game.blueTeamIconUrl);
    }
    if (game.redTeamIconUrl && !map.has(teamKey(game.redTeam))) {
      map.set(teamKey(game.redTeam), game.redTeamIconUrl);
    }
  }

  return map;
};

const TeamIcon = ({
  team,
  iconUrl,
  size = "sm",
}: {
  team: string;
  iconUrl: string | null;
  size?: "sm" | "md";
}) => {
  const isMedium = size === "md";

  if (iconUrl) {
    return (
      <CroppedTeamLogo
        alt={`${team} logo`}
        frameClassName={isMedium ? "h-6 w-8" : "h-5 w-7"}
        height={isMedium ? 24 : 20}
        imageClassName={isMedium ? "h-6" : "h-5"}
        src={iconUrl}
        width={isMedium ? 56 : 48}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded bg-default-200 px-1 font-semibold uppercase text-default-700 ${
        isMedium ? "h-6 min-w-6 text-[11px]" : "h-5 min-w-5 text-[10px]"
      }`}
    >
      {team.slice(0, 2).toUpperCase()}
    </span>
  );
};

const TeamLabel = ({
  team,
  iconUrl,
}: {
  team: string;
  iconUrl: string | null;
}) => (
  <span className="inline-flex items-center gap-2">
    <TeamIcon team={team} iconUrl={iconUrl} />
  <span>{team}</span>
</span>
);

const CurrentMatchupRoster = ({
  title,
  subtitle,
  roster,
  align = "left",
}: {
  title: string;
  subtitle?: string;
  roster: HeadToHeadMatchupRosterEntry[];
  align?: "left" | "right";
}) => {
  const isRight = align === "right";
  const orderedRoster = sortMatchupRoster(roster);

  return (
    <section
      className="relative min-w-0 rounded-2xl border border-default-200/25 bg-content2/25 px-3 py-3 md:px-3.5"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl shadow-[inset_1px_1px_0_rgba(255,255,255,0.03)]"
      />
      <div className={isRight ? "text-right" : ""}>
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-[#f5efdf]">
          {title}
        </p>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[10px] text-[#d9cdb5]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <div className="mt-2 space-y-1.5">
        {orderedRoster.length > 0 ? (
          orderedRoster.map((entry, index) => {
            const team = (
              <span className="inline-flex items-center justify-center">
                <TeamIcon
                  team={entry.playerTeam ?? entry.playerName}
                  iconUrl={entry.playerTeamIconUrl}
                  size="md"
                />
              </span>
            );
            const name = (
              <p className={`truncate text-[13px] font-semibold leading-[1.2] text-white ${isRight ? "text-right" : ""}`}>
                {entry.playerName}
              </p>
            );
            const rowToneClass = index % 2 === 0
              ? "border-default-200/22 bg-content1/32"
              : "border-default-200/14 bg-content1/18";

            return (
              <div
                key={`${entry.playerName}-${entry.playerTeam ?? "team"}-${entry.playerRole ?? "role"}-${index}`}
                className={`grid items-center gap-x-1.5 rounded-lg border px-2.5 py-2 ${
                  isRight
                    ? "grid-cols-[34px_minmax(0,1fr)]"
                    : "grid-cols-[minmax(0,1fr)_34px]"
                } ${rowToneClass}`}
              >
                {isRight ? (
                  <>
                    {team}
                    {name}
                  </>
                ) : (
                  <>
                    {name}
                    {team}
                  </>
                )}
              </div>
            );
          })
        ) : (
          <p className={`text-xs text-[#ddd4c2] ${isRight ? "text-right" : ""}`}>Roster not available.</p>
        )}
      </div>
    </section>
  );
};

const CurrentMatchupLane = ({
  leftRoster,
  rightRoster,
}: {
  leftRoster: HeadToHeadMatchupRosterEntry[];
  rightRoster: HeadToHeadMatchupRosterEntry[];
}) => {
  const orderedLeftRoster = sortMatchupRoster(leftRoster);
  const orderedRightRoster = sortMatchupRoster(rightRoster);
  const rowCount = Math.max(orderedLeftRoster.length, orderedRightRoster.length);

  if (rowCount === 0) {
    return (
      <section className="rounded-2xl border border-default-200/25 bg-content2/24 px-3 py-3.5">
        <p className="text-center text-xs text-[#d9cdb5]">No head-to-head lane available.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#C79B3B]/22 bg-content2/26 px-3.5 py-3.5 shadow-[0_10px_24px_rgba(0,0,0,0.24)]">
      <p className="text-center text-[10px] font-medium uppercase tracking-[0.12em] text-[#ddd4c2]/70">
        Versus Lane
      </p>
      <div className="mt-2.5 space-y-2">
        {Array.from({ length: rowCount }).map((_, index) => {
          const leftEntry = orderedLeftRoster[index] ?? null;
          const rightEntry = orderedRightRoster[index] ?? null;
          const normalizedRole = normalizeRoleLabel(leftEntry?.playerRole ?? rightEntry?.playerRole);
          const roleIcon = matchupRoleIconUrl(normalizedRole);

          return (
            <div
              key={`lane-${index}`}
              className={`grid grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2.5 py-2 ${
                index % 2 === 0
                  ? "border-default-200/24 bg-content1/34"
                  : "border-default-200/16 bg-content1/20"
              }`}
            >
              <p className="truncate text-right text-[13px] font-semibold text-white">
                {leftEntry?.playerName ?? "—"}
              </p>
              <TeamIcon
                team={leftEntry?.playerTeam ?? leftEntry?.playerName ?? "L"}
                iconUrl={leftEntry?.playerTeamIconUrl ?? null}
                size="md"
              />
              <span className="inline-flex h-5 min-w-8 items-center justify-center rounded-full border border-default-200/30 bg-black/25 px-1.5">
                {roleIcon ? (
                  <Image
                    src={roleIcon}
                    alt={`${normalizedRole ?? "Position"} icon`}
                    className="h-3.5 w-3.5 object-contain"
                    height={14}
                    width={14}
                  />
                ) : (
                  <span className="mono-points text-[9px] font-semibold text-[#d9cdb5]">—</span>
                )}
              </span>
              <TeamIcon
                team={rightEntry?.playerTeam ?? rightEntry?.playerName ?? "R"}
                iconUrl={rightEntry?.playerTeamIconUrl ?? null}
                size="md"
              />
              <p className="truncate text-[13px] font-semibold text-white">
                {rightEntry?.playerName ?? "—"}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const UserAvatar = ({
  displayName,
  avatarBorderColor,
  avatarUrl,
  size = "sm",
  variant = "default",
}: {
  displayName: string;
  avatarBorderColor: string | null;
  avatarUrl: string | null;
  size?: "sm" | "xl" | "2xl";
  variant?: "default" | "matchupHero";
}) => {
  const avatarBorderStyle = avatarBorderColor
    ? { outlineColor: avatarBorderColor, borderColor: avatarBorderColor }
    : undefined;
  const sizeClasses = size === "2xl"
    ? "h-14 w-14 text-lg"
    : size === "xl"
      ? "h-12 w-12 text-base"
      : "h-8 w-8 text-[11px]";
  const imageSize = size === "2xl" ? "56px" : size === "xl" ? "48px" : "32px";
  const heroRingClassName =
    variant === "matchupHero"
      ? "border border-default-100/35 ring-1 ring-white/20 shadow-[0_6px_14px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,255,255,0.2)]"
      : "";

  if (avatarUrl) {
    return (
      <span
        className={`relative inline-flex overflow-hidden rounded-full bg-default-200/30 outline outline-2 outline-default-300/40 ${heroRingClassName} ${sizeClasses}`}
        style={avatarBorderStyle}
      >
        <Image
          src={avatarUrl}
          alt={`${displayName} avatar`}
          fill
          sizes={imageSize}
          quality={100}
          unoptimized
          className="object-cover object-center"
        />
        {variant === "matchupHero" ? (
          <span aria-hidden className="pointer-events-none absolute inset-0 bg-black/10" />
        ) : null}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-default-200/40 font-semibold text-default-100 outline outline-2 outline-default-300/40 ${heroRingClassName} ${sizeClasses}`}
      style={avatarBorderStyle}
    >
      {initialsForName(displayName)}
    </span>
  );
};

const resolveInsightLogoSrc = async (): Promise<string> => {
  const relativeSrc = "/img/insight-lol-fantasy-logo.png";
  const filePath = path.join(process.cwd(), "public", "img", "insight-lol-fantasy-logo.png");

  try {
    const fileStat = await stat(filePath);
    return `${relativeSrc}?v=${Math.floor(fileStat.mtimeMs)}`;
  } catch {
    return relativeSrc;
  }
};

export default async function Home() {
  const { supabaseUrl } = getSupabaseAuthEnv();
  let displayName: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;
  let teamName: string | null = null;
  let avatarPath: string | null = null;
  let avatarUrl: string | null = null;
  let avatarBorderColor: string | null = null;
  let userLabel = "Unknown User";
  let userId: string | null = null;

  try {
    const supabase = await getSupabaseAuthServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      redirect("/auth?next=/");
    }

    displayName = getUserDisplayName(user);
    firstName = getUserFirstName(user);
    lastName = getUserLastName(user);
    teamName = getUserTeamName(user);
    avatarPath = getUserAvatarPath(user);
    avatarUrl = getUserAvatarUrl({ user, supabaseUrl });
    avatarBorderColor = getUserAvatarBorderColor(user);
    userId = user.id;
    userLabel = displayName ?? user.id ?? userLabel;
  } catch {
    redirect("/auth?next=/");
  }

  if (!userId) {
    redirect("/auth?next=/");
  }

  const canAccessSettings = await isGlobalAdminUser({
    userId,
    seedIfUnset: true,
  });

  const snapshotResult = await getFantasySnapshot()
    .then((snapshot) => ({ snapshot, error: null as string | null }))
    .catch((error) => ({
      snapshot: null,
      error:
        error instanceof Error ? error.message : "Unable to load fantasy snapshot.",
    }));

  if (!snapshotResult.snapshot) {
    return (
      <main className="mx-auto flex min-h-[100svh] max-w-6xl items-center px-4 py-10 supports-[min-height:100dvh]:min-h-[100dvh]">
        <Card className="w-full border border-danger-300/40 bg-danger-50/5">
          <CardHeader className="flex flex-col items-start gap-2">
            <Chip color="danger" variant="flat">
              Data Error
            </Chip>
            <h1 className="text-2xl font-semibold">Fantasy Snapshot Unavailable</h1>
          </CardHeader>
          <CardBody className="space-y-3 text-sm text-default-600">
            <p>{snapshotResult.error}</p>
            <p>
              Check network access to Leaguepedia and verify{" "}
              <Code size="sm">src/data/friends-league.json</Code> or{" "}
              <Code size="sm">LEAGUEPEDIA_PAGE</Code>.
            </p>
          </CardBody>
        </Card>
      </main>
    );
  }

  const snapshot = snapshotResult.snapshot;
  const sourceLink = sourceLinkForPage(snapshot.sourcePage);
  const insightLogoSrc = await resolveInsightLogoSrc();
  const recentGames = [...snapshot.games].slice(-6).reverse();
  const teamIcons = buildTeamIconLookup(snapshot.games);
  const [dashboardStandings, userDraftSummaries] = await Promise.all([
    getDashboardStandings({
      playerTotals: snapshot.playerTotals,
      games: snapshot.games,
    }),
    listDraftSummariesForUser({ userId }),
  ]);
  const hasCompletedDraft = dashboardStandings.completedDraftId !== null;
  const headToHead = dashboardStandings.headToHead;
  const draftedRows = dashboardStandings.rows.filter((row) => row.drafted);
  const currentWeekView =
    headToHead.currentWeekNumber === null
      ? null
      : headToHead.weeks.find((entry) => entry.weekNumber === headToHead.currentWeekNumber) ?? null;
  const currentUserCurrentWeekMatchup =
    currentWeekView?.matchups.find(
      (entry) => entry.left.userId === userId || entry.right?.userId === userId,
    ) ?? null;
  const currentUserOnLeftSide =
    currentUserCurrentWeekMatchup?.left.userId === userId;
  const currentUserWeekSide = currentUserCurrentWeekMatchup
    ? (currentUserOnLeftSide
      ? currentUserCurrentWeekMatchup.left
      : currentUserCurrentWeekMatchup.right)
    : null;
  const currentUserOpponentSide = currentUserCurrentWeekMatchup
    ? (currentUserOnLeftSide
      ? currentUserCurrentWeekMatchup.right
      : currentUserCurrentWeekMatchup.left)
    : null;
  const currentWeekStatus = currentWeekView?.status ?? headToHead.weekStatus;
  const currentUserWeekPoints = currentUserWeekSide?.weekPoints ?? 0;
  const currentOpponentWeekPoints = currentUserOpponentSide?.weekPoints ?? 0;
  const totalCurrentWeekPoints = currentUserWeekPoints + currentOpponentWeekPoints;
  const currentUserWeekPointShare =
    totalCurrentWeekPoints > 0 ? (currentUserWeekPoints / totalCurrentWeekPoints) * 100 : 50;
  const currentOpponentWeekPointShare =
    totalCurrentWeekPoints > 0 ? (currentOpponentWeekPoints / totalCurrentWeekPoints) * 100 : 50;
  const hasLiveScoringStarted = currentUserWeekPoints > 0 || currentOpponentWeekPoints > 0;
  const currentMatchupHeadToHeadRecord = (() => {
    if (!currentUserWeekSide || !currentUserOpponentSide) {
      return null;
    }

    let currentUserWins = 0;
    let opponentWins = 0;
    let ties = 0;

    for (const week of headToHead.weeks) {
      if (week.status !== "finalized") {
        continue;
      }

      for (const matchup of week.matchups) {
        if (!matchup.right) {
          continue;
        }

        const isCurrentPair =
          (matchup.left.userId === currentUserWeekSide.userId &&
            matchup.right.userId === currentUserOpponentSide.userId) ||
          (matchup.left.userId === currentUserOpponentSide.userId &&
            matchup.right.userId === currentUserWeekSide.userId);

        if (!isCurrentPair) {
          continue;
        }

        if (matchup.isTie) {
          ties += 1;
          continue;
        }

        if (matchup.winnerUserId === currentUserWeekSide.userId) {
          currentUserWins += 1;
        } else if (matchup.winnerUserId === currentUserOpponentSide.userId) {
          opponentWins += 1;
        }
      }
    }

    return { currentUserWins, opponentWins, ties };
  })();
  const currentUserHeadToHeadLabel = currentMatchupHeadToHeadRecord
    ? formatHeadToHeadRecord(
      currentMatchupHeadToHeadRecord.currentUserWins,
      currentMatchupHeadToHeadRecord.opponentWins,
      currentMatchupHeadToHeadRecord.ties,
    )
    : "0-0";
  const currentOpponentHeadToHeadLabel = currentMatchupHeadToHeadRecord
    ? formatHeadToHeadRecord(
      currentMatchupHeadToHeadRecord.opponentWins,
      currentMatchupHeadToHeadRecord.currentUserWins,
      currentMatchupHeadToHeadRecord.ties,
    )
    : "0-0";
  const currentUserMatchupLabel = formatMatchupLabel(
    currentUserWeekSide?.teamName ?? currentUserWeekSide?.displayName,
  );
  const currentOpponentMatchupLabel = formatMatchupLabel(
    currentUserOpponentSide?.teamName ?? currentUserOpponentSide?.displayName,
  );
  const showPlaceholderScore =
    currentUserCurrentWeekMatchup?.status === "upcoming" ||
    (currentUserCurrentWeekMatchup?.status === "active" && !hasLiveScoringStarted);
  const currentUserScoreDisplay = showPlaceholderScore ? "—" : formatPoints(currentUserWeekPoints);
  const currentOpponentScoreDisplay = showPlaceholderScore
    ? "—"
    : formatPoints(currentOpponentWeekPoints);
  const scoreStateLabel =
    currentUserCurrentWeekMatchup?.status === "upcoming"
      ? "Projected"
      : currentUserCurrentWeekMatchup?.status === "finalized"
        ? "Final"
        : "Live";
  const currentPointSplitLabel =
    `${Math.round(currentUserWeekPointShare)}% / ${Math.round(currentOpponentWeekPointShare)}%`;
  return (
    <main className="mx-auto min-h-[100svh] w-full max-w-7xl px-3 py-5 pb-28 supports-[min-height:100dvh]:min-h-[100dvh] md:px-6 md:py-8 md:pb-24">
      <Navbar
        className="overflow-visible bg-transparent"
        classNames={{
          wrapper: "min-h-16 max-w-none gap-2 px-2 sm:px-3",
        }}
        isBlurred={false}
        isBordered={false}
        maxWidth="full"
        position="static"
      >
        <NavbarBrand>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={insightLogoSrc}
            alt="Insight LoL Fantasy"
            width={900}
            height={170}
            className="h-auto w-full max-w-[120px]"
          />
        </NavbarBrand>
        <NavbarContent justify="end">
          <NavbarItem>
            <div className="flex items-center gap-2">
              <ScoringMethodologyDrawer scoring={snapshot.scoring} />
              <AccountWidget
                avatarPath={avatarPath}
                avatarBorderColor={avatarBorderColor}
                avatarUrl={avatarUrl}
                canAccessSettings={canAccessSettings}
                firstName={firstName}
                initialScoring={snapshot.scoring}
                lastName={lastName}
                layout="navbar"
                teamName={teamName}
                userLabel={userLabel}
              />
            </div>
          </NavbarItem>
        </NavbarContent>
      </Navbar>

      <GlobalChatPanel currentUserId={userId} />

      {userDraftSummaries.length > 0 ? (
        <>
          <section className="mt-4">
            <UserDraftRoomAccess drafts={userDraftSummaries} />
          </section>
          <Divider className="my-4" />
        </>
      ) : (
        <Divider className="my-4" />
      )}

      {headToHead.enabled ? (
        <>
          <Card className="relative mb-4 overflow-hidden border border-default-200/25 bg-content1/85 shadow-[0_8px_24px_rgba(0,0,0,0.22)]">
            <CardHeader className="min-h-[62px] border-b border-default-200/20 bg-gradient-to-r from-[#171617]/95 via-[#141414]/95 to-[#171617]/95 px-3 py-2 md:px-5">
              <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center gap-2">
                <div className="flex min-w-0 items-center justify-start">
                  <div className="ml-[3px] inline-flex h-8 w-8 rotate-[5deg] items-center justify-center rounded-full border border-[#C79B3B]/30 bg-[#C79B3B]/10 text-[10px] font-semibold uppercase tracking-wide text-[#f4deab]">
                    W{headToHead.currentWeekNumber ?? headToHead.weekNumber ?? "—"}
                  </div>
                </div>
                <div className="min-w-0 text-center">
                  <h2 className="text-lg font-semibold text-[#C79B3B] md:text-xl">Current Matchup</h2>
                  <p className="-mt-0.5 truncate text-[11px] italic leading-[1.1] text-[#efe6d3] md:text-xs">
                    {formatShortDate(headToHead.weekStartsOn)} - {formatShortDate(headToHead.weekEndsOn)}
                  </p>
                  <span className="mx-auto mt-1 block h-px w-24 bg-gradient-to-r from-transparent via-[#C79B3B]/45 to-transparent" />
                </div>
                <div className="relative flex min-w-0 items-center justify-end gap-2">
                  <Chip
                    className={`scale-95 ${currentWeekStatus === "active" ? "animate-pulse [animation-duration:1.8s]" : ""}`}
                    color={weekStatusChipColor(currentWeekStatus)}
                    variant="flat"
                  >
                    {formatWeekStatusLabel(currentWeekStatus)}
                  </Chip>
                </div>
              </div>
            </CardHeader>
            <CardBody className="relative px-3 pb-3 pt-5 md:px-5">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_8%,rgba(199,155,59,0.1),transparent_50%)]"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.02] [background-image:linear-gradient(rgba(255,255,255,0.85)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.85)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,transparent_50%,black_90%)]"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(8,10,14,0.58)_30%,rgba(8,10,14,0.2)_62%,transparent_88%)]"
              />
              {currentUserCurrentWeekMatchup && currentUserWeekSide ? (
                <div className="relative z-10 mx-auto w-full max-w-6xl">
                  <div className="relative z-10 -mt-5 mb-3 flex justify-center">
                    <div className="relative w-full max-w-[560px] overflow-hidden rounded-2xl border border-default-200/30 bg-[#10141a]/94 px-4 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.28)]">
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-[#6f9dd6]/5 to-transparent"
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-[#d88278]/5 to-transparent"
                      />
                      <span
                        aria-hidden
                        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_left_center,rgba(0,0,0,0.24),transparent_58%),radial-gradient(circle_at_right_center,rgba(0,0,0,0.24),transparent_58%)]"
                      />
                      <div className="relative grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
                        <span
                          aria-hidden
                          className="pointer-events-none absolute left-1/2 top-1.5 hidden h-4 w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-white/14 to-transparent sm:block"
                        />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute bottom-1.5 left-1/2 hidden h-4 w-px -translate-x-1/2 bg-gradient-to-t from-transparent via-white/14 to-transparent sm:block"
                        />
                        <div className="min-w-0 text-center">
                          <div className="mx-auto w-fit">
                            <UserAvatar
                              avatarBorderColor={currentUserWeekSide.avatarBorderColor}
                              avatarUrl={currentUserWeekSide.avatarUrl}
                              displayName={currentUserWeekSide.displayName}
                              size="2xl"
                              variant="matchupHero"
                            />
                          </div>
                          <p className="mt-0 truncate text-sm font-semibold tracking-[0.02em] text-white">
                            {currentUserMatchupLabel}
                          </p>
                          <p className="mono-points -mt-0.5 text-[7px] leading-tight text-[#cdbf9f]/55">
                            H2H {currentUserHeadToHeadLabel}
                          </p>
                        </div>
                        <span className="relative mx-auto inline-flex h-14 w-14 items-center justify-center rounded-full border border-[#e6c87a]/65 bg-[#C79B3B]/14 text-[14px] font-semibold uppercase tracking-[0.12em] text-[#f0d58e] shadow-[0_10px_20px_rgba(0,0,0,0.36)]">
                          <span
                            aria-hidden
                            className="pointer-events-none absolute -inset-2 rounded-full bg-[#C79B3B]/22 blur-md"
                          />
                          <span className="relative z-[1] inline-block translate-x-[0.6px]">VS</span>
                        </span>
                        <div className="min-w-0 text-center">
                          {currentUserOpponentSide ? (
                            <>
                              <div className="mx-auto w-fit">
                                <UserAvatar
                                  avatarBorderColor={currentUserOpponentSide.avatarBorderColor}
                                  avatarUrl={currentUserOpponentSide.avatarUrl}
                                  displayName={currentUserOpponentSide.displayName}
                                  size="2xl"
                                  variant="matchupHero"
                                />
                              </div>
                              <p className="mt-0 truncate text-sm font-semibold tracking-[0.02em] text-white">
                                {currentOpponentMatchupLabel}
                              </p>
                              <p className="mono-points -mt-0.5 text-[7px] leading-tight text-[#cdbf9f]/55">
                                H2H {currentOpponentHeadToHeadLabel}
                              </p>
                            </>
                          ) : (
                            <span className="inline-flex h-11 items-center rounded-full border border-[#C79B3B]/30 px-3 text-xs font-semibold uppercase tracking-wide text-[#efe6d3]">
                              BYE WEEK
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mb-2 flex justify-center">
                    <span className="h-px w-64 bg-default-300/30" />
                  </div>

                  <div className="mb-3 rounded-2xl border border-default-200/28 bg-black/35 px-4 py-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.2)]">
                    <div className={`grid items-end gap-3 ${currentUserOpponentSide ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "grid-cols-1"}`}>
                      <div className="text-left">
                        <p className="text-[10px] uppercase tracking-[0.1em] text-[#d9cdb5]">Your {scoreStateLabel}</p>
                        <p
                          className={`mono-points ${
                            showPlaceholderScore
                              ? "text-xl font-medium text-[#d9cdb5]"
                              : "text-2xl font-semibold text-white"
                          }`}
                        >
                          {currentUserScoreDisplay}
                        </p>
                        {showPlaceholderScore ? (
                          <p className="text-[10px] text-[#b8ad95]">Pending</p>
                        ) : null}
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-[10px] uppercase tracking-[0.1em] text-[#d9cdb5]">
                          {currentUserOpponentSide ? `Opponent ${scoreStateLabel}` : "Bye Week"}
                        </p>
                        <p
                          className={`mono-points ${
                            showPlaceholderScore
                              ? "text-xl font-medium text-[#d9cdb5]"
                              : "text-2xl font-semibold text-white"
                          }`}
                        >
                          {currentOpponentScoreDisplay}
                        </p>
                        {showPlaceholderScore ? (
                          <p className="text-[10px] text-[#b8ad95]">Pending</p>
                        ) : null}
                      </div>
                    </div>
                    {currentUserOpponentSide ? (
                      <div className="relative mt-2">
                        <div
                          className={`relative h-5 overflow-hidden rounded-full border border-default-200/35 ${
                            showPlaceholderScore ? "bg-white/7" : "bg-white/10"
                          }`}
                        >
                          <span
                            className={`absolute inset-y-0 left-0 ${
                              showPlaceholderScore ? "bg-[#6f9dd6]/25" : "bg-[#6f9dd6]"
                            }`}
                            style={{ width: `${currentUserWeekPointShare}%` }}
                          />
                          <span
                            className={`absolute inset-y-0 right-0 ${
                              showPlaceholderScore ? "bg-[#d88278]/25" : "bg-[#d88278]"
                            }`}
                            style={{ width: `${currentOpponentWeekPointShare}%` }}
                          />
                          <span aria-hidden className="pointer-events-none absolute left-1/4 top-0 h-full w-px bg-white/15" />
                          <span aria-hidden className="pointer-events-none absolute left-3/4 top-0 h-full w-px bg-white/15" />
                        </div>
                        <span className="mono-points absolute left-1/2 top-1/2 inline-flex h-6 min-w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-[#C79B3B]/40 bg-[#111217]/95 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#C79B3B]">
                          VS
                        </span>
                      </div>
                    ) : null}
                    <p className="mt-2 text-center text-[10px] text-[#d9cdb5]">
                      {showPlaceholderScore
                        ? `${scoreStateLabel} view will populate at first game start`
                        : `${scoreStateLabel} scoring is in progress • Split ${currentPointSplitLabel}`}
                    </p>
                  </div>

                  <div
                    className={`relative grid items-start gap-3 md:gap-4 ${
                      currentUserOpponentSide
                        ? "grid-cols-1 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)_minmax(0,0.95fr)] xl:gap-4"
                        : "grid-cols-1"
                    }`}
                  >
                    <CurrentMatchupRoster
                      align="left"
                      title="Your roster"
                      subtitle={currentUserWeekSide.teamName ?? currentUserWeekSide.displayName}
                      roster={currentUserWeekSide.roster}
                    />
                    {currentUserOpponentSide ? (
                      <div className="hidden xl:block">
                        <CurrentMatchupLane
                          leftRoster={currentUserWeekSide.roster}
                          rightRoster={currentUserOpponentSide.roster}
                        />
                      </div>
                    ) : null}
                    {currentUserOpponentSide ? (
                      <CurrentMatchupRoster
                        align="right"
                        title="Opponent roster"
                        subtitle={currentUserOpponentSide.teamName ?? currentUserOpponentSide.displayName}
                        roster={currentUserOpponentSide.roster}
                      />
                    ) : (
                      <p className="text-center text-lg font-semibold text-white">BYE WEEK</p>
                    )}
                  </div>
                  {currentUserOpponentSide ? (
                    <div className="mt-3 xl:hidden">
                      <CurrentMatchupLane
                        leftRoster={currentUserWeekSide.roster}
                        rightRoster={currentUserOpponentSide.roster}
                      />
                    </div>
                  ) : null}

                </div>
              ) : (
                <p className="px-2 py-2 text-sm text-[#efe6d3]">
                  No matchup is assigned to your account for the current week yet.
                </p>
              )}
            </CardBody>
          </Card>

          <section className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
            <WeeklyMatchupsPanel headToHead={headToHead} />

            <Card className="bg-content1/70">
              <CardHeader>
                <div>
                  <h2 className="text-xl font-semibold">H2H Rankings</h2>
                  <p className="text-xs text-default-500">
                    Sorted by H2H record, then total points for tie-breakers.
                  </p>
                </div>
              </CardHeader>
              <CardBody className="space-y-2">
                <div className="space-y-2 md:hidden">
                  {headToHead.standings.map((entry) => (
                    <div
                      key={entry.userId}
                      className="rounded-large border border-default-200/30 bg-content2/35 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-xs text-default-500">#{entry.rank}</span>
                          <UserAvatar
                            avatarBorderColor={entry.avatarBorderColor}
                            avatarUrl={entry.avatarUrl}
                            displayName={entry.displayName}
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {entry.teamName ?? entry.displayName}
                            </p>
                            <p className="truncate text-[11px] text-default-500">
                              {entry.displayName}
                            </p>
                          </div>
                        </div>
                        <p className="mono-points text-xs text-default-400">
                          PF {formatPoints(entry.pointsFor)} • PA {formatPoints(entry.pointsAgainst)}
                        </p>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-default-500">
                        <p>
                          Record:{" "}
                          <span className="mono-points text-default-300">
                            {formatHeadToHeadRecord(entry.wins, entry.losses, entry.ties)}
                          </span>
                        </p>
                        <p>
                          Win%:{" "}
                          <span className="mono-points text-default-300">{formatWinPct(entry.winPct)}</span>
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden overflow-x-auto md:block">
                  <table
                    className={`w-full min-w-[420px] border-collapse text-left text-sm ${TABLE_BAND_CLASS}`}
                  >
                    <thead>
                      <tr className="text-default-500">
                        <th className="px-2 py-2 font-medium">#</th>
                        <th className="px-2 py-2 font-medium">Team</th>
                        <th className="px-2 py-2 font-medium">Record</th>
                        <th className="px-2 py-2 font-medium">Win%</th>
                        <th className="px-2 py-2 font-medium">PF</th>
                        <th className="px-2 py-2 font-medium">PA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {headToHead.standings.map((entry) => (
                        <tr
                          key={entry.userId}
                          className="border-t border-default-200/30 hover:bg-default-100/20"
                        >
                          <td className="px-2 py-2 align-middle">{entry.rank}</td>
                          <td className="px-2 py-2 align-middle">
                            <div className="flex items-center gap-2">
                              <UserAvatar
                                avatarBorderColor={entry.avatarBorderColor}
                                avatarUrl={entry.avatarUrl}
                                displayName={entry.displayName}
                              />
                              <div className="min-w-0">
                                <p className="truncate">
                                  {entry.teamName ?? entry.displayName}
                                </p>
                                <p className="truncate text-xs text-default-500">
                                  {entry.displayName}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="mono-points px-2 py-2 align-middle">
                            {formatHeadToHeadRecord(entry.wins, entry.losses, entry.ties)}
                          </td>
                          <td className="mono-points px-2 py-2 align-middle">{formatWinPct(entry.winPct)}</td>
                          <td className="mono-points px-2 py-2 align-middle">{formatPoints(entry.pointsFor)}</td>
                          <td className="mono-points px-2 py-2 align-middle">{formatPoints(entry.pointsAgainst)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-default-500">
                  Finalized weeks: {headToHead.finalizedWeekCount} • Matchup cycle length:{" "}
                  {headToHead.cycleLength}
                </p>
              </CardBody>
            </Card>
          </section>
        </>
      ) : null}

      <Card className="bg-content1/70">
        <CardHeader className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">League Standings</h2>
            <p className="text-xs text-default-500">
              {hasCompletedDraft ? (
                <>
                  Latest completed draft:{" "}
                  <span className="font-medium">{dashboardStandings.completedDraftName}</span>{" "}
                  {dashboardStandings.completedDraftAt
                    ? `(${new Date(dashboardStandings.completedDraftAt).toLocaleString()})`
                    : ""}
                </>
              ) : (
                "Showing registered users. Complete a draft to unlock standings and roster breakdowns."
              )}
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="space-y-2 md:hidden">
            {dashboardStandings.rows.length === 0 ? (
              <p className="rounded-large border border-default-200/30 bg-content2/35 px-3 py-3 text-sm text-default-500">
                No registered users found.
              </p>
            ) : (
              dashboardStandings.rows.map((entry, index) => {
                const isLeader =
                  hasCompletedDraft &&
                  draftedRows.length > 0 &&
                  draftedRows[0].userId === entry.userId &&
                  entry.drafted;
                const isLastPlace =
                  dashboardStandings.rows.length > 1 &&
                  index === dashboardStandings.rows.length - 1;

                return (
                  <div
                    key={entry.userId}
                    className="rounded-large border border-default-200/30 bg-content2/35 p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-xs text-default-500">#{index + 1}</span>
                        <UserAvatar
                          avatarBorderColor={entry.avatarBorderColor}
                          avatarUrl={entry.avatarUrl}
                          displayName={entry.displayName}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">
                            {entry.teamName ?? entry.displayName}
                          </p>
                          {entry.teamName ? (
                            <p className="truncate text-[11px] text-default-500">
                              {entry.displayName}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      {isLeader ? (
                        <span aria-label="Leader" className="inline-flex items-center" title="Leader">
                          <Crown className="h-4 w-4 text-[#C79B3B]" />
                        </span>
                      ) : isLastPlace ? (
                        <span
                          aria-label="Last place"
                          className="inline-flex items-center"
                          title="Last place"
                        >
                          <span aria-hidden className="text-sm leading-none">
                            💩
                          </span>
                        </span>
                      ) : null}
                    </div>
                    {hasCompletedDraft ? (
                      entry.drafted ? (
                        <div className="mt-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2 text-xs text-default-500">
                            <p>
                              Total:{" "}
                              <span className="mono-points font-semibold text-default-200">
                                {formatPoints(entry.totalPoints)}
                              </span>
                            </p>
                            <p>
                              Avg/Pick:{" "}
                              <span className="mono-points font-semibold text-default-200">
                                {formatPoints(entry.averagePerPick)}
                              </span>
                            </p>
                          </div>
                          <RosterBreakdownStack
                            ariaLabel={`${entry.displayName} roster breakdown`}
                            breakdown={entry.breakdown}
                          />
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-default-500">Not drafted yet.</p>
                      )
                    ) : (
                      <p className="mt-2 text-xs text-default-500">Not drafted yet.</p>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table
              className={`w-full border-collapse text-left text-sm ${
                hasCompletedDraft ? "min-w-[980px]" : "min-w-[560px]"
              } ${TABLE_BAND_CLASS}`}
            >
              <thead>
                <tr className="text-default-500">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">User</th>
                  {hasCompletedDraft ? (
                    <>
                      <th className="px-2 py-2 font-medium">Total</th>
                      <th className="px-2 py-2 font-medium">Avg / Pick</th>
                      <th className="px-2 py-2 font-medium">Roster Breakdown</th>
                    </>
                  ) : (
                    <th className="px-2 py-2 font-medium">Draft Status</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {dashboardStandings.rows.length === 0 ? (
                  <tr className="border-t border-default-200/30">
                    <td
                      className="px-2 py-3 text-sm text-default-500"
                      colSpan={hasCompletedDraft ? 5 : 3}
                    >
                      No registered users found.
                    </td>
                  </tr>
                ) : (
                  dashboardStandings.rows.map((entry, index) => {
                    const isLeader =
                      hasCompletedDraft &&
                      draftedRows.length > 0 &&
                      draftedRows[0].userId === entry.userId &&
                      entry.drafted;
                    const isLastPlace =
                      dashboardStandings.rows.length > 1 &&
                      index === dashboardStandings.rows.length - 1;

                    return (
                      <tr
                        key={entry.userId}
                        className="border-t border-default-200/30 align-top hover:bg-default-100/20"
                      >
                        <td className="px-2 py-2 align-middle">{index + 1}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <UserAvatar
                              avatarBorderColor={entry.avatarBorderColor}
                              avatarUrl={entry.avatarUrl}
                              displayName={entry.displayName}
                            />
                            <div className="min-w-0">
                              <p className="truncate font-semibold">
                                {entry.teamName ?? entry.displayName}
                              </p>
                              {entry.teamName ? (
                                <p className="truncate text-xs text-default-500">
                                  {entry.displayName}
                                </p>
                              ) : null}
                            </div>
                            {isLeader ? (
                              <span
                                aria-label="Leader"
                                className="inline-flex items-center"
                                title="Leader"
                              >
                                <Crown className="h-4 w-4 text-[#C79B3B]" />
                              </span>
                            ) : isLastPlace ? (
                              <span
                                aria-label="Last place"
                                className="inline-flex items-center"
                                title="Last place"
                              >
                                <span aria-hidden className="text-sm leading-none">
                                  💩
                                </span>
                              </span>
                            ) : null}
                          </div>
                        </td>
                        {hasCompletedDraft ? (
                          <>
                            <td className="mono-points px-2 py-2 align-middle">
                              {entry.drafted ? formatPoints(entry.totalPoints) : "—"}
                            </td>
                            <td className="px-2 py-2 align-middle">
                              {entry.drafted ? formatPoints(entry.averagePerPick) : "—"}
                            </td>
                            <td className="px-2 py-2 align-middle">
                              {entry.drafted ? (
                                <div className="min-w-[320px] space-y-2">
                                  <RosterBreakdownStack
                                    ariaLabel={`${entry.displayName} roster breakdown`}
                                    breakdown={entry.breakdown}
                                  />
                                </div>
                              ) : (
                                <p className="text-xs text-default-500">Not drafted yet.</p>
                              )}
                            </td>
                          </>
                        ) : (
                          <td className="px-2 py-2 text-sm text-default-500">Not drafted yet.</td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card className="bg-content1/70">
          <CardHeader>
            <div>
              <h2 className="text-xl font-semibold">Player Leaderboard</h2>
              <p className="text-xs text-default-500">
                Total fantasy points on this source page.
              </p>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="space-y-2 md:hidden">
              {snapshot.playerTotals.slice(0, 20).map((entry, index) => (
                <div
                  key={entry.player}
                  className="rounded-large border border-default-200/30 bg-content2/35 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs text-default-500">#{index + 1}</p>
                      <p className="text-sm font-semibold">{entry.player}</p>
                    </div>
                    <p className="mono-points text-sm font-semibold">
                      {formatPoints(entry.fantasyPoints)}
                    </p>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-default-500">
                    <p>
                      Team:{" "}
                      <span className="text-default-300">
                        <TeamLabel
                          team={entry.team}
                          iconUrl={teamIcons.get(teamKey(entry.team)) ?? null}
                        />
                      </span>
                    </p>
                    <p>
                      Record: {formatRecord(entry.wins, entry.games)} • KDA:{" "}
                      {formatKda(entry.kills, entry.deaths, entry.assists)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table
                className={`w-full min-w-[720px] border-collapse text-left text-sm ${TABLE_BAND_CLASS}`}
              >
                <thead>
                  <tr className="text-default-500">
                    <th className="px-2 py-2 font-medium">#</th>
                    <th className="px-2 py-2 font-medium">Player</th>
                    <th className="px-2 py-2 font-medium">Team</th>
                    <th className="px-2 py-2 font-medium">Record</th>
                    <th className="px-2 py-2 font-medium">KDA</th>
                    <th className="px-2 py-2 font-medium">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.playerTotals.slice(0, 20).map((entry, index) => (
                    <tr
                      key={entry.player}
                      className="border-t border-default-200/30 hover:bg-default-100/20"
                    >
                      <td className="px-2 py-2">{index + 1}</td>
                      <td className="px-2 py-2">{entry.player}</td>
                      <td className="px-2 py-2">
                        <TeamLabel
                          team={entry.team}
                          iconUrl={teamIcons.get(teamKey(entry.team)) ?? null}
                        />
                      </td>
                      <td className="px-2 py-2">{formatRecord(entry.wins, entry.games)}</td>
                      <td className="px-2 py-2">
                        {formatKda(entry.kills, entry.deaths, entry.assists)}
                      </td>
                      <td className="mono-points px-2 py-2">{formatPoints(entry.fantasyPoints)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <Card className="bg-content1/70">
          <CardHeader>
            <div>
              <h2 className="text-xl font-semibold">Best Single Games</h2>
              <p className="text-xs text-default-500">
                Highest single-map fantasy performances.
              </p>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="space-y-2 md:hidden">
              {snapshot.topPerformances.map((entry) => (
                <div
                  key={`${entry.gameId}-${entry.player}-${entry.champion}`}
                  className="rounded-large border border-default-200/30 bg-content2/35 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {entry.player}{" "}
                        <span className="text-xs text-default-500">({entry.champion})</span>
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-default-500">
                        <TeamIcon
                          team={entry.team}
                          iconUrl={teamIcons.get(teamKey(entry.team)) ?? null}
                        />
                        <span>vs</span>
                        <TeamIcon
                          team={entry.opponent}
                          iconUrl={teamIcons.get(teamKey(entry.opponent)) ?? null}
                        />
                      </p>
                    </div>
                    <p className="mono-points text-sm font-semibold">{formatPoints(entry.fantasyPoints)}</p>
                  </div>
                  <p className="mt-2 text-xs text-default-500">
                    {formatShortDate(entry.playedAtLabel)} • KDA{" "}
                    {formatKda(entry.kills, entry.deaths, entry.assists)}
                  </p>
                </div>
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table
                className={`w-full min-w-[700px] border-collapse text-left text-sm ${TABLE_BAND_CLASS}`}
              >
                <thead>
                  <tr className="text-default-500">
                    <th className="px-2 py-2 font-medium">Player</th>
                    <th className="px-2 py-2 font-medium">Game</th>
                    <th className="px-2 py-2 font-medium">Date</th>
                    <th className="px-2 py-2 font-medium">KDA</th>
                    <th className="px-2 py-2 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.topPerformances.map((entry) => (
                    <tr
                      key={`${entry.gameId}-${entry.player}-${entry.champion}`}
                      className="border-t border-default-200/30 align-top hover:bg-default-100/20"
                    >
                      <td className="px-2 py-2">
                        <p className="flex items-center gap-1">
                          <TeamIcon
                            team={entry.team}
                            iconUrl={teamIcons.get(teamKey(entry.team)) ?? null}
                          />
                          <span>
                            {entry.player}{" "}
                            <span className="text-xs text-default-500">({entry.champion})</span>
                          </span>
                        </p>
                      </td>
                      <td className="px-2 py-2">
                        <p className="flex items-center gap-1">
                          <TeamIcon
                            team={entry.team}
                            iconUrl={teamIcons.get(teamKey(entry.team)) ?? null}
                          />
                          <span>vs</span>
                          <TeamIcon
                            team={entry.opponent}
                            iconUrl={teamIcons.get(teamKey(entry.opponent)) ?? null}
                          />
                        </p>
                      </td>
                      <td className="px-2 py-2">{formatShortDate(entry.playedAtLabel)}</td>
                      <td className="px-2 py-2">{formatKda(entry.kills, entry.deaths, entry.assists)}</td>
                      <td className="mono-points px-2 py-2">{formatPoints(entry.fantasyPoints)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </section>

      <Card className="mt-4 bg-content1/70">
        <CardHeader>
          <div>
            <h2 className="text-xl font-semibold">Recent Games</h2>
            <p className="text-xs text-default-500">Most recent parsed match cards.</p>
          </div>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recentGames.map((game) => (
            <Card key={game.id} className="border border-default-200/30 bg-content2/60">
              <CardHeader className="flex items-start justify-between gap-2 pb-1">
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <TeamLabel team={game.blueTeam} iconUrl={game.blueTeamIconUrl} />
                    <span className="text-default-500">vs</span>
                    <TeamLabel team={game.redTeam} iconUrl={game.redTeamIconUrl} />
                  </p>
                  <p className="text-xs text-default-500">
                    {game.playedAtLabel ?? "Time not available"}
                  </p>
                </div>
                <Chip
                  color={game.winner ? "success" : "default"}
                  size="sm"
                  variant="flat"
                >
                  {game.winner ?? "Unknown"}
                </Chip>
              </CardHeader>
              <CardBody className="pt-0 text-sm text-default-600">
                <p>
                  Kills: {game.blueTeam} {game.blueKills ?? "-"} - {game.redKills ?? "-"}{" "}
                  {game.redTeam}
                </p>
                <p>
                  Duration: {game.duration ?? "N/A"} | Patch: {game.patch ?? "N/A"}
                </p>
              </CardBody>
            </Card>
          ))}
        </CardBody>
      </Card>

      <footer className="mt-6 border-t border-default-200/30 pt-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-default-500">
          <span>Updated: {new Date(snapshot.generatedAt).toLocaleString()}</span>
          <span>•</span>
          <span>
            Source:{" "}
            <Link href={sourceLink} target="_blank" rel="noreferrer" underline="hover">
              {snapshot.sourcePage}
            </Link>
          </span>
        </div>
      </footer>
    </main>
  );
}
