import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Code } from "@heroui/code";
import { Divider } from "@heroui/divider";
import { Link } from "@heroui/link";
import { Progress } from "@heroui/progress";
import { stat } from "node:fs/promises";
import path from "node:path";
import Image from "next/image";
import { redirect } from "next/navigation";
import { AccountWidget } from "@/components/auth/account-widget";
import { GlobalChatPanel } from "@/components/chat/global-chat-panel";
import { UserDraftRoomAccess } from "@/components/drafts/user-draft-room-access";
import { isGlobalAdminUser } from "@/lib/admin-access";
import { getDashboardStandings } from "@/lib/dashboard-standings";
import { listDraftSummariesForUser } from "@/lib/draft-data";
import { getFantasySnapshot } from "@/lib/get-fantasy-snapshot";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import {
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

const integerFormat = new Intl.NumberFormat("en-US");

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

const teamKey = (team: string): string => team.trim().toLowerCase();

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
}: {
  team: string;
  iconUrl: string | null;
}) => {
  if (iconUrl) {
    return (
      <Image
        src={iconUrl}
        alt={`${team} logo`}
        width={48}
        height={20}
        className="h-5 w-auto shrink-0 object-contain"
      />
    );
  }

  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded bg-default-200 px-1 text-[10px] font-semibold uppercase text-default-700">
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

const UserAvatar = ({
  displayName,
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) => {
  if (avatarUrl) {
    return (
      <span className="relative inline-flex h-8 w-8 overflow-hidden rounded-full border border-default-300/40 bg-default-200/30">
        <Image
          src={avatarUrl}
          alt={`${displayName} avatar`}
          fill
          sizes="32px"
          quality={100}
          unoptimized
          className="object-cover object-center"
        />
      </span>
    );
  }

  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-default-300/40 bg-default-200/40 text-[11px] font-semibold text-default-600">
      {initialsForName(displayName)}
    </span>
  );
};

const resolveInsightLogoSrc = async (): Promise<string> => {
  const relativeSrc = "/img/insight_new.png";
  const filePath = path.join(process.cwd(), "public", "img", "insight_new.png");

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
      <main className="mx-auto flex min-h-screen max-w-6xl items-center px-4 py-10">
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
    }),
    listDraftSummariesForUser({ userId }),
  ]);
  const hasCompletedDraft = dashboardStandings.completedDraftId !== null;
  const draftedRows = dashboardStandings.rows.filter((row) => row.drafted);
  const standingsLeaderPoints = draftedRows[0]?.totalPoints ?? 1;

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-3 py-5 md:px-6 md:py-8">
      <section className="mt-2 flex items-center justify-center py-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={insightLogoSrc}
          alt="Insight"
          width={1110}
          height={210}
          className="h-auto w-full max-w-[760px]"
        />
      </section>

      <section className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="overflow-visible bg-content1/70">
          <CardHeader className="pb-0 text-xs uppercase tracking-wide text-default-500">
            My Profile
          </CardHeader>
          <CardBody>
            <AccountWidget
              avatarPath={avatarPath}
              avatarUrl={avatarUrl}
              canAccessSettings={canAccessSettings}
              firstName={firstName}
              lastName={lastName}
              teamName={teamName}
              userLabel={userLabel}
            />
          </CardBody>
        </Card>

        <Card className="bg-content1/70">
          <CardHeader className="pb-0 text-xs uppercase tracking-wide text-default-500">
            Active Fantasy Players
          </CardHeader>
          <CardBody>
            <p className="mono-points text-3xl font-semibold">
              {integerFormat.format(snapshot.playerCount)}
            </p>
            <Progress
              aria-label="Player volume"
              className="mt-3"
              color="secondary"
              value={Math.min(100, (snapshot.playerCount / 50) * 100)}
            />
          </CardBody>
        </Card>

        <Card className="bg-content1/70">
          <CardHeader className="pb-0 text-xs uppercase tracking-wide text-default-500">
            Scoring Formula
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="mono-points text-sm text-default-600">
              K {snapshot.scoring.kill} / D {snapshot.scoring.death} / A{" "}
              {snapshot.scoring.assist} / W {snapshot.scoring.win}
            </p>
            <Code size="sm">csPer100 = {snapshot.scoring.csPer100}</Code>
          </CardBody>
        </Card>
      </section>

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
        <CardBody className="overflow-x-auto">
          <table
            className={`w-full border-collapse text-left text-sm ${
              hasCompletedDraft ? "min-w-[980px]" : "min-w-[560px]"
            }`}
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
                const leaderRatio = entry.drafted
                  ? (entry.totalPoints / standingsLeaderPoints) * 100
                  : 0;
                const isLeader =
                  hasCompletedDraft &&
                  draftedRows.length > 0 &&
                  draftedRows[0].userId === entry.userId &&
                  entry.drafted;

                return (
                  <tr
                    key={entry.userId}
                    className="border-t border-default-200/30 align-top hover:bg-default-100/20"
                  >
                    <td className="px-2 py-2">{index + 1}</td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-2">
                        <UserAvatar avatarUrl={entry.avatarUrl} displayName={entry.displayName} />
                        <div className="min-w-0">
                          <p className="truncate">{entry.displayName}</p>
                        </div>
                        {isLeader ? (
                          <Chip size="sm" color="warning" variant="flat">
                            Leader
                          </Chip>
                        ) : null}
                      </div>
                    </td>
                    {hasCompletedDraft ? (
                      <>
                        <td className="mono-points px-2 py-2">
                          {entry.drafted ? formatPoints(entry.totalPoints) : "—"}
                        </td>
                        <td className="px-2 py-2">
                          {entry.drafted ? formatPoints(entry.averagePerPick) : "—"}
                        </td>
                        <td className="px-2 py-2">
                          {entry.drafted ? (
                            <div className="min-w-[320px] space-y-2">
                              <p className="text-xs text-default-500">
                                {entry.breakdown
                                  .map((pick) => `${pick.playerName} (${formatPoints(pick.points)})`)
                                  .join(" • ")}
                              </p>
                              <Progress
                                aria-label={`${entry.displayName} total points`}
                                color="primary"
                                size="sm"
                                value={Math.min(100, leaderRatio)}
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
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
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
                    <td className="px-2 py-2">{formatKda(entry.kills, entry.deaths, entry.assists)}</td>
                    <td className="mono-points px-2 py-2">{formatPoints(entry.fantasyPoints)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <CardBody className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-left text-sm">
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
                          <span className="text-xs text-default-500">
                            ({entry.champion})
                          </span>
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
