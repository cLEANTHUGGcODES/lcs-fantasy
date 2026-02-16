import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { ParsedGame, PlayerRole } from "@/types/fantasy";

const LEAGUEPEDIA_API = "https://lol.fandom.com/api.php";
const REQUEST_HEADERS = {
  "user-agent": "lcs-fantasy-friends-app/0.1 (+self-hosted)",
} as const;

type ParseSectionsResponse =
  | {
      parse: {
        sections: {
          index: string;
          line: string;
          level: string;
        }[];
      };
    }
  | {
      error: {
        info: string;
      };
    };

type ParseTextResponse =
  | {
      parse: {
        text: {
          "*": string;
        };
      };
    }
  | {
      error: {
        info: string;
      };
    };

type TeamLookup = {
  teamName: string;
  pageTitle: string;
  teamIconUrl: string | null;
};

type RolePlayer = {
  playerName: string;
  playerPage: string | null;
  playerRole: PlayerRole;
};

export type SupplementalRosterPlayer = {
  playerName: string;
  playerPage: string | null;
  playerTeam: string;
  playerRole: PlayerRole;
  teamIconUrl: string | null;
};

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const normalizeSectionName = (value: string): string =>
  normalizeText(value).toLowerCase().replace(/\s+/g, "");

const resolveRoleFromText = (value: string): PlayerRole | null => {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/\btop\b/.test(normalized)) {
    return "TOP";
  }
  if (/\bjung/.test(normalized)) {
    return "JNG";
  }
  if (/\bmid\b/.test(normalized)) {
    return "MID";
  }
  if (/\b(adc|bot|bottom)\b/.test(normalized)) {
    return "ADC";
  }
  if (/\b(support|sup)\b/.test(normalized)) {
    return "SUP";
  }

  return null;
};

const isLikelyPlayerHandle = (value: string): boolean =>
  /^[\p{L}\p{N}][\p{L}\p{N}'._-]{1,24}$/u.test(value);

const toNormalizedWikiTitle = (href: string | null | undefined): string | null => {
  if (!href) {
    return null;
  }
  const trimmed = href.trim();
  if (!trimmed.startsWith("/wiki/")) {
    return null;
  }
  const encoded = trimmed.slice("/wiki/".length).split(/[?#]/)[0];
  if (!encoded || encoded.includes(":")) {
    return null;
  }
  try {
    return decodeURIComponent(encoded).replace(/_/g, " ").trim() || null;
  } catch {
    return encoded.replace(/_/g, " ").trim() || null;
  }
};

const extractPlayerInfo = (
  $: cheerio.CheerioAPI,
  node: cheerio.Cheerio<AnyNode>,
): { playerName: string; playerPage: string | null } | null => {
  const anchors = node.find("a[href]").toArray();
  for (const anchor of anchors) {
    const href = $(anchor).attr("href") ?? "";
    if (!href.startsWith("/wiki/")) {
      continue;
    }
    const title = href.slice("/wiki/".length);
    if (!title || title.includes(":")) {
      continue;
    }

    const text = normalizeText($(anchor).text());
    if (!text || !isLikelyPlayerHandle(text)) {
      continue;
    }
    return {
      playerName: text,
      playerPage: toNormalizedWikiTitle(href),
    };
  }

  const text = normalizeText(node.text());
  if (!text) {
    return null;
  }

  const token = text.split(/\s+/).find((entry) => isLikelyPlayerHandle(entry));
  if (!token) {
    return null;
  }

  return {
    playerName: token,
    playerPage: null,
  };
};

const parseActiveRosterSection = (html: string): RolePlayer[] => {
  const $ = cheerio.load(html);
  const byRole = new Map<PlayerRole, { playerName: string; playerPage: string | null }>();

  const addRolePlayer = (
    role: PlayerRole,
    player: { playerName: string; playerPage: string | null },
  ) => {
    if (!byRole.has(role)) {
      byRole.set(role, player);
    }
  };

  // First pass: parse tables that expose explicit Player/Role headers.
  $("table").each((_, tableElement) => {
    const table = $(tableElement);
    const rows = table.find("tr");
    if (rows.length < 2) {
      return;
    }

    const headerCells = rows.first().find("th,td");
    const headers = headerCells
      .toArray()
      .map((cell) => normalizeText($(cell).text()).toLowerCase());
    const playerIndex = headers.findIndex((header) => header.includes("player"));
    const roleIndex = headers.findIndex((header) => header.includes("role"));
    if (playerIndex < 0 || roleIndex < 0) {
      return;
    }

    rows.slice(1).each((__, rowElement) => {
      const cells = $(rowElement).children("th,td");
      const maxIndex = Math.max(playerIndex, roleIndex);
      if (cells.length <= maxIndex) {
        return;
      }

      const role = resolveRoleFromText(cells.eq(roleIndex).text());
      if (!role || byRole.has(role)) {
        return;
      }

      const player = extractPlayerInfo($, cells.eq(playerIndex));
      if (!player) {
        return;
      }

      addRolePlayer(role, player);
    });
  });

  // Fallback: parse any row that includes a recognizable lane role.
  if (byRole.size < 5) {
    $("tr").each((_, rowElement) => {
      const row = $(rowElement);
      const role = resolveRoleFromText(row.text());
      if (!role || byRole.has(role)) {
        return;
      }

      const player = extractPlayerInfo($, row);
      if (!player) {
        return;
      }

      addRolePlayer(role, player);
    });
  }

  return [...byRole.entries()].map(([playerRole, player]) => ({
    playerName: player.playerName,
    playerPage: player.playerPage,
    playerRole,
  }));
};

const fetchSectionList = async (
  pageTitle: string,
): Promise<{ index: string; line: string; level: string }[]> => {
  const query = new URLSearchParams({
    action: "parse",
    format: "json",
    page: pageTitle,
    prop: "sections",
  });

  const response = await fetch(`${LEAGUEPEDIA_API}?${query.toString()}`, {
    next: { revalidate: 900 },
    headers: REQUEST_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed fetching sections for "${pageTitle}" (${response.status}).`);
  }

  const payload = (await response.json()) as ParseSectionsResponse;
  if ("error" in payload) {
    throw new Error(`Leaguepedia section parse error: ${payload.error.info}`);
  }

  return payload.parse.sections ?? [];
};

const resolveActiveRosterSectionIndex = (
  sections: { index: string; line: string; level: string }[],
): string | null => {
  const playerRosterIndex = sections.findIndex(
    (section) => normalizeSectionName(section.line) === "playerroster",
  );

  if (playerRosterIndex >= 0) {
    const rosterLevel = Number.parseInt(sections[playerRosterIndex].level, 10);
    for (let index = playerRosterIndex + 1; index < sections.length; index += 1) {
      const section = sections[index];
      const sectionLevel = Number.parseInt(section.level, 10);
      if (Number.isFinite(sectionLevel) && Number.isFinite(rosterLevel) && sectionLevel <= rosterLevel) {
        break;
      }
      if (normalizeSectionName(section.line) === "active") {
        return section.index;
      }
    }
  }

  return (
    sections.find((section) => normalizeSectionName(section.line) === "active")?.index ??
    null
  );
};

const fetchSectionHtml = async (
  pageTitle: string,
  sectionIndex: string,
): Promise<string> => {
  const query = new URLSearchParams({
    action: "parse",
    format: "json",
    page: pageTitle,
    prop: "text",
    section: sectionIndex,
  });

  const response = await fetch(`${LEAGUEPEDIA_API}?${query.toString()}`, {
    next: { revalidate: 900 },
    headers: REQUEST_HEADERS,
  });

  if (!response.ok) {
    throw new Error(
      `Failed fetching roster section for "${pageTitle}" (${response.status}).`,
    );
  }

  const payload = (await response.json()) as ParseTextResponse;
  if ("error" in payload) {
    throw new Error(`Leaguepedia roster parse error: ${payload.error.info}`);
  }

  return payload.parse.text["*"] ?? "";
};

const toNormalizedPageTitle = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }

  if (cleaned.startsWith("/wiki/")) {
    try {
      return decodeURIComponent(cleaned.slice("/wiki/".length)).replace(/_/g, " ").trim();
    } catch {
      return cleaned.slice("/wiki/".length).replace(/_/g, " ").trim();
    }
  }

  return cleaned.replace(/_/g, " ").trim();
};

const collectTeamsFromGames = (games: ParsedGame[]): TeamLookup[] => {
  const byTeamKey = new Map<string, TeamLookup>();

  const addTeam = ({
    teamName,
    pageTitle,
    teamIconUrl,
  }: {
    teamName: string;
    pageTitle: string | null | undefined;
    teamIconUrl: string | null;
  }) => {
    const normalizedName = normalizeText(teamName);
    if (!normalizedName) {
      return;
    }

    const key = normalizedName.toLowerCase();
    if (byTeamKey.has(key)) {
      return;
    }

    byTeamKey.set(key, {
      teamName: normalizedName,
      pageTitle: toNormalizedPageTitle(pageTitle) ?? normalizedName,
      teamIconUrl,
    });
  };

  for (const game of games) {
    addTeam({
      teamName: game.blueTeam,
      pageTitle: game.blueTeamPage,
      teamIconUrl: game.blueTeamIconUrl,
    });
    addTeam({
      teamName: game.redTeam,
      pageTitle: game.redTeamPage,
      teamIconUrl: game.redTeamIconUrl,
    });
  }

  return [...byTeamKey.values()];
};

const fetchActiveStartersForTeam = async (
  team: TeamLookup,
): Promise<SupplementalRosterPlayer[]> => {
  const sections = await fetchSectionList(team.pageTitle);
  const activeSectionIndex = resolveActiveRosterSectionIndex(sections);
  if (!activeSectionIndex) {
    return [];
  }

  const sectionHtml = await fetchSectionHtml(team.pageTitle, activeSectionIndex);
  const starters = parseActiveRosterSection(sectionHtml);

  return starters.map((starter) => ({
    playerName: starter.playerName,
    playerPage: starter.playerPage,
    playerTeam: team.teamName,
    playerRole: starter.playerRole,
    teamIconUrl: team.teamIconUrl,
  }));
};

export const fetchSupplementalStartersForGames = async (
  games: ParsedGame[],
): Promise<SupplementalRosterPlayer[]> => {
  const teams = collectTeamsFromGames(games);
  if (teams.length === 0) {
    return [];
  }

  const startersByTeam = await Promise.all(
    teams.map(async (team) => {
      try {
        return await fetchActiveStartersForTeam(team);
      } catch (error) {
        console.warn(
          `[draft] unable to fetch active roster for ${team.teamName} (${team.pageTitle}):`,
          error instanceof Error ? error.message : error,
        );
        return [];
      }
    }),
  );

  const uniqueByKey = new Map<string, SupplementalRosterPlayer>();
  for (const starter of startersByTeam.flat()) {
    const key = `${starter.playerName.toLowerCase()}::${starter.playerTeam.toLowerCase()}`;
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, starter);
    }
  }

  return [...uniqueByKey.values()];
};
