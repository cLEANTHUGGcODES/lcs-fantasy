import { buildPlayerPoolFromGames } from "@/lib/draft-engine";
import { requireAuthUser } from "@/lib/draft-auth";
import { isGlobalAdminUser } from "@/lib/admin-access";
import { processDueDrafts } from "@/lib/draft-automation";
import { listDraftSummaries, listRegisteredUsers } from "@/lib/draft-data";
import { fetchSupplementalStartersForGames } from "@/lib/leaguepedia-rosters";
import { getLatestSnapshotFromSupabase } from "@/lib/supabase-match-store";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getUserDisplayName } from "@/lib/user-profile";
import type { ParsedGame } from "@/types/fantasy";

type CreateDraftBody = {
  name?: string;
  leagueSlug?: string;
  seasonYear?: number;
  sourcePage?: string;
  scheduledAt?: string;
  roundCount?: number;
  pickSeconds?: number;
  participantUserIds?: string[];
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasGames = (payload: unknown): payload is { games: ParsedGame[] } =>
  isObject(payload) && Array.isArray(payload.games);

export async function GET() {
  try {
    await requireAuthUser();
    await processDueDrafts();
    const drafts = await listDraftSummaries();
    return Response.json({ drafts }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load drafts.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuthUser();
    const canManageDrafts = await isGlobalAdminUser({ userId: user.id });
    if (!canManageDrafts) {
      return Response.json({ error: "Only the admin can create drafts." }, { status: 403 });
    }
    const body = (await request.json()) as CreateDraftBody;

    const name = body.name?.trim() ?? "";
    const leagueSlug = body.leagueSlug?.trim() ?? "LCS";
    const seasonYear = Number(body.seasonYear ?? 2026);
    const sourcePage = body.sourcePage?.trim() ?? "";
    const scheduledAt = body.scheduledAt ?? "";
    const roundCount = Number(body.roundCount ?? 5);
    const pickSeconds = Number(body.pickSeconds ?? 75);
    const participantUserIds = Array.isArray(body.participantUserIds)
      ? [...new Set(body.participantUserIds)]
      : [];

    if (!name) {
      return Response.json(
        { error: "Draft name is required." },
        { status: 400 },
      );
    }
    if (!sourcePage) {
      return Response.json(
        { error: "A source page is required for this draft." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(seasonYear) || seasonYear < 2020 || seasonYear > 2100) {
      return Response.json(
        { error: "Season year must be a valid year." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(roundCount) || roundCount < 1 || roundCount > 20) {
      return Response.json(
        { error: "Round count must be between 1 and 20." },
        { status: 400 },
      );
    }
    if (!Number.isFinite(pickSeconds) || pickSeconds < 10 || pickSeconds > 900) {
      return Response.json(
        { error: "Pick timer must be between 10 and 900 seconds." },
        { status: 400 },
      );
    }
    const scheduledDate = new Date(scheduledAt);
    if (Number.isNaN(scheduledDate.getTime())) {
      return Response.json(
        { error: "Scheduled draft time is invalid." },
        { status: 400 },
      );
    }
    if (participantUserIds.length < 2) {
      return Response.json(
        { error: "At least two participants are required." },
        { status: 400 },
      );
    }

    const [snapshot, registeredUsers] = await Promise.all([
      getLatestSnapshotFromSupabase(sourcePage),
      listRegisteredUsers(),
    ]);

    if (!hasGames(snapshot.payload)) {
      return Response.json(
        {
          error:
            "Snapshot payload is missing parsed games. Run /api/admin/sync-leaguepedia first.",
        },
        { status: 400 },
      );
    }

    const usersById = new Map(registeredUsers.map((entry) => [entry.userId, entry]));
    const missingUserId = participantUserIds.find((userId) => !usersById.has(userId));
    if (missingUserId) {
      return Response.json(
        {
          error: `Selected participant is no longer registered: ${missingUserId}`,
        },
        { status: 400 },
      );
    }

    const participants = participantUserIds.map((userId, index) => {
      const found = usersById.get(userId)!;

      return {
        userId,
        email: found.email,
        displayName: found.displayName,
        firstName: found.firstName,
        lastName: found.lastName,
        teamName: found.teamName,
        draftPosition: index + 1,
      };
    });

    const missingNameParticipant = participants.find(
      (entry) => !entry.firstName || !entry.lastName,
    );
    if (missingNameParticipant) {
      return Response.json(
        {
          error: `Participant ${missingNameParticipant.userId} is missing a first/last name in profile settings.`,
        },
        { status: 400 },
      );
    }

    const missingTeamParticipant = participants.find((entry) => !entry.teamName);
    if (missingTeamParticipant) {
      return Response.json(
        {
          error: `Participant ${missingTeamParticipant.displayName} is missing a team name in profile settings.`,
        },
        { status: 400 },
      );
    }

    const supplementalPlayers = await fetchSupplementalStartersForGames(
      snapshot.payload.games,
    );
    const playerPool = buildPlayerPoolFromGames(snapshot.payload.games, sourcePage, {
      supplementalPlayers,
    });
    if (playerPool.length === 0) {
      return Response.json(
        { error: "No players found in the selected source page snapshot." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServerClient();
    const createdByLabel = getUserDisplayName(user) ?? user.id;

    const { data: createdDraft, error: draftError } = await supabase
      .from("fantasy_drafts")
      .insert({
        name,
        league_slug: leagueSlug,
        season_year: seasonYear,
        source_page: sourcePage,
        scheduled_at: scheduledDate.toISOString(),
        round_count: roundCount,
        pick_seconds: pickSeconds,
        status: "scheduled",
        created_by_user_id: user.id,
        created_by_label: createdByLabel,
      })
      .select("id")
      .single<{ id: number }>();

    if (draftError) {
      throw new Error(`Unable to create draft: ${draftError.message}`);
    }

    const draftId = createdDraft.id;

    const participantInserts = participants.map((entry) => ({
      draft_id: draftId,
      user_id: entry.userId,
      email: entry.email,
      display_name: entry.displayName,
      first_name: entry.firstName,
      last_name: entry.lastName,
      team_name: entry.teamName,
      draft_position: entry.draftPosition,
    }));

    const { error: participantError } = await supabase
      .from("fantasy_draft_participants")
      .insert(participantInserts);

    if (participantError) {
      throw new Error(`Unable to add draft participants: ${participantError.message}`);
    }

    const playerPoolInserts = playerPool.map((entry) => ({
      draft_id: draftId,
      team_name: entry.playerName,
      team_icon_url: entry.teamIconUrl,
      player_team: entry.playerTeam,
      player_role: entry.playerRole,
      source_page: entry.sourcePage,
    }));
    const { error: playerPoolError } = await supabase
      .from("fantasy_draft_team_pool")
      .insert(playerPoolInserts);

    if (playerPoolError) {
      throw new Error(`Unable to seed draft player pool: ${playerPoolError.message}`);
    }

    return Response.json(
      {
        ok: true,
        draftId,
      },
      { status: 201 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to create draft.";
    const status = message === "UNAUTHORIZED" ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
