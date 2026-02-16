import { isGlobalAdminUser } from "@/lib/admin-access";
import { requireAuthUser } from "@/lib/draft-auth";
import { buildPlayerPoolFromGames } from "@/lib/draft-engine";
import { withResolvedDraftPlayerImages } from "@/lib/draft-player-images";
import { fetchSupplementalStartersForGames } from "@/lib/leaguepedia-rosters";
import { getLatestSnapshotFromSupabase } from "@/lib/supabase-match-store";
import type { ParsedGame } from "@/types/fantasy";

type ValidateSourceBody = {
  sourcePage?: string;
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasGames = (payload: unknown): payload is { games: ParsedGame[] } =>
  isObject(payload) && Array.isArray(payload.games);

export async function POST(request: Request) {
  try {
    const user = await requireAuthUser();
    const canManageDrafts = await isGlobalAdminUser({ userId: user.id });
    if (!canManageDrafts) {
      return Response.json(
        { error: "Only the admin can validate source pages." },
        { status: 403 },
      );
    }

    const body = (await request.json()) as ValidateSourceBody;
    const sourcePage = body.sourcePage?.trim() ?? "";
    if (!sourcePage) {
      return Response.json({ error: "A source page is required." }, { status: 400 });
    }

    const snapshot = await getLatestSnapshotFromSupabase(sourcePage);
    if (!hasGames(snapshot.payload)) {
      return Response.json(
        {
          error:
            "Snapshot payload is missing parsed games. Run /api/admin/sync-leaguepedia first.",
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
    const playerPoolWithImages = await withResolvedDraftPlayerImages(playerPool);
    const playerImageCount = playerPoolWithImages.reduce(
      (count, entry) => count + (entry.playerImageUrl ? 1 : 0),
      0,
    );

    return Response.json(
      {
        ok: true,
        sourcePage,
        storedAt: snapshot.storedAt,
        gameCount: snapshot.payload.games.length,
        playerCount: playerPoolWithImages.length,
        playerImageCount,
      },
      { status: 200 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to validate source page.";
    const status =
      message === "UNAUTHORIZED"
        ? 401
        : message.startsWith("No snapshot found in Supabase")
          ? 404
          : 500;
    return Response.json({ error: message }, { status });
  }
}
