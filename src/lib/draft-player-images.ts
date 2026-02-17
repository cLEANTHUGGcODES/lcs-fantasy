import { resolveLeaguepediaPlayerImages } from "@/lib/leaguepedia-player-images";

type DraftImageCandidate = {
  playerName: string;
  playerTeam: string | null;
  playerPage?: string | null;
  playerImageUrl: string | null;
};

const resolvePoolBasePlayerName = (entry: {
  playerName: string;
  playerTeam: string | null;
}): string => {
  const rawName = entry.playerName.trim();
  const team = entry.playerTeam?.trim();
  if (!team) {
    return rawName;
  }
  const suffix = ` (${team})`;
  if (!rawName.endsWith(suffix)) {
    return rawName;
  }
  return rawName.slice(0, -suffix.length).trim();
};

export const withResolvedDraftPlayerImages = async <T extends DraftImageCandidate>(
  players: T[],
): Promise<T[]> => {
  if (players.length === 0) {
    return players;
  }

  try {
    const unresolved = players
      .map((entry, index) => ({
        entry,
        index,
      }))
      .filter(({ entry }) => !entry.playerImageUrl);

    if (unresolved.length === 0) {
      return players;
    }

    const imageRequests = unresolved.map(({ entry, index }) => ({
      key: `${index}`,
      lookupTitles: [entry.playerPage ?? null, resolvePoolBasePlayerName(entry)],
    }));
    const imagesByKey = await resolveLeaguepediaPlayerImages(imageRequests);
    if (imagesByKey.size === 0) {
      return players;
    }

    return players.map((entry, index) => ({
      ...entry,
      playerImageUrl: imagesByKey.get(`${index}`) ?? entry.playerImageUrl ?? null,
    }));
  } catch (error) {
    console.warn(
      "[draft] unable to resolve Leaguepedia player portraits:",
      error instanceof Error ? error.message : error,
    );
    return players;
  }
};
