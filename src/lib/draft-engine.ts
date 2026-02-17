import type { DraftParticipant, DraftPick, DraftPlayerPoolEntry } from "@/types/draft";
import type { ParsedGame, PlayerRole } from "@/types/fantasy";

type PlayerPoolSeed = {
  playerName: string;
  playerTeam: string;
  playerPage: string | null;
  playerRole: PlayerRole | null;
  teamIconUrl: string | null;
};

const normalizePageTitleForCompare = (value: string | null | undefined): string =>
  value?.trim().replace(/_/g, " ").replace(/\s+/g, " ").toLowerCase() ?? "";

const scorePlayerPageSpecificity = ({
  pageTitle,
  baseName,
}: {
  pageTitle: string | null | undefined;
  baseName: string;
}): number => {
  if (!pageTitle) {
    return 0;
  }
  const normalizedPage = normalizePageTitleForCompare(pageTitle);
  if (!normalizedPage) {
    return 0;
  }

  const normalizedBaseName = normalizePageTitleForCompare(baseName);
  if (normalizedPage === normalizedBaseName) {
    return 1;
  }

  if (
    normalizedBaseName &&
    normalizedPage.startsWith(`${normalizedBaseName} (`) &&
    normalizedPage.endsWith(")")
  ) {
    return 4;
  }

  if (normalizedPage.includes("(") && normalizedPage.includes(")")) {
    return 3;
  }

  return 2;
};

const pickPreferredPlayerPage = ({
  existingPage,
  candidatePage,
  baseName,
}: {
  existingPage: string | null | undefined;
  candidatePage: string | null | undefined;
  baseName: string;
}): string | null => {
  const candidate = candidatePage?.trim() ?? "";
  if (!candidate) {
    return existingPage?.trim() ?? null;
  }
  const existing = existingPage?.trim() ?? "";
  if (!existing) {
    return candidate;
  }

  const existingScore = scorePlayerPageSpecificity({
    pageTitle: existing,
    baseName,
  });
  const candidateScore = scorePlayerPageSpecificity({
    pageTitle: candidate,
    baseName,
  });

  if (candidateScore > existingScore) {
    return candidate;
  }
  return existing;
};

export interface PickSlot {
  overallPick: number;
  roundNumber: number;
  roundPick: number;
  participantIndex: number;
}

export const getPickSlot = (
  participantCount: number,
  overallPick: number,
): PickSlot => {
  if (participantCount < 2) {
    throw new Error("At least 2 participants are required.");
  }
  if (overallPick < 1) {
    throw new Error("overallPick must be >= 1.");
  }

  const roundNumber = Math.ceil(overallPick / participantCount);
  const offset = (overallPick - 1) % participantCount;

  // 3RR reverse snake:
  // round 1 runs 1 -> N
  // rounds 2 and 3 run N -> 1
  // round 4+ alternates from there (4: 1 -> N, 5: N -> 1, ...).
  const participantIndex = isThreeRoundReversalRound(roundNumber)
    ? participantCount - 1 - offset
    : offset;

  return {
    overallPick,
    roundNumber,
    roundPick: offset + 1,
    participantIndex,
  };
};

export const isThreeRoundReversalRound = (roundNumber: number): boolean => {
  if (!Number.isFinite(roundNumber) || roundNumber < 1) {
    return false;
  }
  if (roundNumber === 1) {
    return false;
  }
  if (roundNumber === 2 || roundNumber === 3) {
    return true;
  }
  return roundNumber % 2 === 1;
};

export const buildPlayerPoolFromGames = (
  games: ParsedGame[],
  sourcePage: string,
  {
    supplementalPlayers = [],
  }: {
    supplementalPlayers?: PlayerPoolSeed[];
  } = {},
): Omit<DraftPlayerPoolEntry, "id" | "draftId" | "createdAt">[] => {
  const byPlayerKey = new Map<
    string,
    {
      baseName: string;
      playerTeam: string;
      playerPage: string | null;
      teamIconUrl: string | null;
      roleCounts: Map<PlayerRole, number>;
    }
  >();

  for (const game of games) {
    for (const player of game.players) {
      const key = `${player.name.trim().toLowerCase()}::${player.team.trim().toLowerCase()}`;
      const teamIconUrl =
        player.side === "blue" ? game.blueTeamIconUrl ?? null : game.redTeamIconUrl ?? null;

      if (!byPlayerKey.has(key)) {
        byPlayerKey.set(key, {
          baseName: player.name.trim(),
          playerTeam: player.team.trim(),
          playerPage: player.pageTitle ?? null,
          teamIconUrl,
          roleCounts: new Map([[player.role, 1]]),
        });
        continue;
      }

      const existing = byPlayerKey.get(key)!;
      existing.playerPage = pickPreferredPlayerPage({
        existingPage: existing.playerPage,
        candidatePage: player.pageTitle ?? null,
        baseName: existing.baseName,
      });
      existing.teamIconUrl = existing.teamIconUrl ?? teamIconUrl;
      existing.roleCounts.set(player.role, (existing.roleCounts.get(player.role) ?? 0) + 1);
    }
  }

  for (const player of supplementalPlayers) {
    const baseName = player.playerName.trim();
    const playerTeam = player.playerTeam.trim();
    if (!baseName || !playerTeam) {
      continue;
    }

    const key = `${baseName.toLowerCase()}::${playerTeam.toLowerCase()}`;
    if (!byPlayerKey.has(key)) {
        byPlayerKey.set(key, {
          baseName,
          playerTeam,
          playerPage: player.playerPage,
          teamIconUrl: player.teamIconUrl,
          roleCounts: player.playerRole
            ? new Map<PlayerRole, number>([[player.playerRole, 1]])
          : new Map<PlayerRole, number>(),
      });
      continue;
    }

    const existing = byPlayerKey.get(key)!;
    existing.playerPage = pickPreferredPlayerPage({
      existingPage: existing.playerPage,
      candidatePage: player.playerPage,
      baseName,
    });
    existing.teamIconUrl = existing.teamIconUrl ?? player.teamIconUrl;
    if (player.playerRole) {
      existing.roleCounts.set(
        player.playerRole,
        (existing.roleCounts.get(player.playerRole) ?? 0) + 1,
      );
    }
  }

  const nameCounts = new Map<string, number>();
  for (const entry of byPlayerKey.values()) {
    const key = entry.baseName.toLowerCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }

  const resolvePrimaryRole = (roleCounts: Map<PlayerRole, number>): PlayerRole | null => {
    let selectedRole: PlayerRole | null = null;
    let selectedCount = -1;
    for (const [role, count] of roleCounts.entries()) {
      if (count > selectedCount) {
        selectedRole = role;
        selectedCount = count;
      }
    }
    return selectedRole;
  };

  return [...byPlayerKey.values()]
    .map((entry) => {
      const duplicateName = (nameCounts.get(entry.baseName.toLowerCase()) ?? 0) > 1;
      const playerName = duplicateName
        ? `${entry.baseName} (${entry.playerTeam})`
        : entry.baseName;
      return {
        playerName,
        playerPage: entry.playerPage,
        playerImageUrl: null,
        playerTeam: entry.playerTeam,
        playerRole: resolvePrimaryRole(entry.roleCounts),
        teamIconUrl: entry.teamIconUrl,
        sourcePage,
      };
    })
    .sort((a, b) => a.playerName.localeCompare(b.playerName));
};

export const resolveNextPick = ({
  participants,
  picks,
  roundCount,
}: {
  participants: DraftParticipant[];
  picks: DraftPick[];
  roundCount: number;
}) => {
  const totalPickCount = participants.length * roundCount;
  if (totalPickCount === 0 || picks.length >= totalPickCount) {
    return null;
  }

  const slot = getPickSlot(participants.length, picks.length + 1);
  const participant = participants[slot.participantIndex];
  if (!participant) {
    throw new Error("Unable to resolve next draft participant.");
  }

  return {
    overallPick: slot.overallPick,
    roundNumber: slot.roundNumber,
    roundPick: slot.roundPick,
    participantUserId: participant.userId,
    participantDisplayName: participant.displayName,
    draftPosition: participant.draftPosition,
  };
};

export const resolveCurrentPickDeadline = ({
  pickSeconds,
  status,
  startedAt,
  picks,
}: {
  pickSeconds: number;
  status: "scheduled" | "live" | "paused" | "completed";
  startedAt: string | null;
  picks: DraftPick[];
}): string | null => {
  if (status !== "live" || pickSeconds <= 0) {
    return null;
  }

  const anchor = picks.length > 0 ? picks[picks.length - 1].pickedAt : startedAt;
  if (!anchor) {
    return null;
  }

  const deadline = new Date(anchor).getTime() + pickSeconds * 1000;
  return new Date(deadline).toISOString();
};
