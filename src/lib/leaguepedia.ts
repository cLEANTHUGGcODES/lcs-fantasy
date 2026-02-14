import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { ParsedGame, PlayerGameStat, PlayerRole, TeamSide } from "@/types/fantasy";

const LEAGUEPEDIA_API = "https://lol.fandom.com/api.php";

export const DEFAULT_PAGE =
  "LCS/2026_Season/Lock-In";

const SCOREBOARDS_SEGMENT = "/Scoreboards";

type ParseResponse =
  | {
      parse: {
        title: string;
        revid?: number;
        text: {
          "*": string;
        };
      };
    }
  | {
      error: {
        code: string;
        info: string;
      };
    };

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const extractInt = (value: string): number | null => {
  const match = value.match(/-?\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
};

const parseGold = (value: string): number | null => {
  const cleaned = normalizeText(value).toLowerCase();
  if (!cleaned) {
    return null;
  }

  const match = cleaned.match(/(\d+(?:\.\d+)?)(k)?/);
  if (!match) {
    return null;
  }

  const numeric = Number.parseFloat(match[1]);
  if (Number.isNaN(numeric)) {
    return null;
  }
  return match[2] ? Math.round(numeric * 1000) : Math.round(numeric);
};

const parseKda = (
  value: string,
): { kills: number; deaths: number; assists: number } | null => {
  const match = normalizeText(value).match(/^(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    kills: Number.parseInt(match[1], 10),
    deaths: Number.parseInt(match[2], 10),
    assists: Number.parseInt(match[3], 10),
  };
};

const parseDateInLocalTuple = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const parts = value.split(",").map((part) => Number.parseInt(part, 10));
  if (parts.length < 5 || parts.some((part) => Number.isNaN(part))) {
    return null;
  }

  const [year, month, day, hour, minute] = parts;
  const pad = (input: number): string => `${input}`.padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`;
};

const isDataImage = (value: string): boolean =>
  value.toLowerCase().startsWith("data:image/");

const normalizeImageUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const cleaned = value.trim();
  if (!cleaned || isDataImage(cleaned)) {
    return null;
  }

  if (cleaned.startsWith("//")) {
    return `https:${cleaned}`;
  }

  if (cleaned.startsWith("/")) {
    try {
      return new URL(cleaned, "https://lol.fandom.com").toString();
    } catch {
      return null;
    }
  }

  return cleaned;
};

const firstUrlInSet = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const first = value.split(",")[0]?.trim().split(/\s+/)[0];
  return normalizeImageUrl(first);
};

const normalizeWikiPageTitle = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const cleaned = value.trim();
  if (!cleaned) {
    return null;
  }

  let candidate = cleaned;
  try {
    if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
      candidate = new URL(cleaned).pathname;
    }
  } catch {
    // Ignore URL parse errors and treat the input as a raw path.
  }

  if (!candidate.startsWith("/wiki/")) {
    return null;
  }

  const encodedTitle = candidate
    .slice("/wiki/".length)
    .split(/[?#]/)[0]
    .trim();
  if (!encodedTitle) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(encodedTitle).replace(/_/g, " ").trim();
    return decoded || null;
  } catch {
    return encodedTitle.replace(/_/g, " ").trim() || null;
  }
};

const toPageKey = (value: string): string =>
  value.trim().replace(/\s+/g, "_");

const normalizePageInput = (value: string): string => {
  const fromWikiLink = normalizeWikiPageTitle(value);
  if (fromWikiLink) {
    return toPageKey(fromWikiLink);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return toPageKey(DEFAULT_PAGE);
  }

  return toPageKey(trimmed);
};

const scoreboardPrefixForTournament = (page: string): string =>
  `${page.split(SCOREBOARDS_SEGMENT)[0]}${SCOREBOARDS_SEGMENT}`;

const isScoreboardOrTournamentSubpage = (
  candidate: string,
  tournamentPage: string,
): boolean => {
  const normalizedCandidate = toPageKey(candidate);
  const prefix = scoreboardPrefixForTournament(tournamentPage);
  return (
    normalizedCandidate === prefix ||
    normalizedCandidate.startsWith(`${prefix}/`)
  );
};

const readScoreboardLinksFromHtml = (
  html: string,
  tournamentPage: string,
): string[] => {
  const $ = cheerio.load(html);
  const found = new Set<string>();

  $("a[href]").each((_, link) => {
    const title = normalizeWikiPageTitle($(link).attr("href"));
    if (!title) {
      return;
    }

    const normalizedTitle = toPageKey(title);
    if (isScoreboardOrTournamentSubpage(normalizedTitle, tournamentPage)) {
      found.add(normalizedTitle);
    }
  });

  return [...found];
};

type ParsedPagePayload = {
  page: string;
  revisionId: number | null;
  html: string;
};

const fetchParsedPagePayload = async (page: string): Promise<ParsedPagePayload> => {
  const query = new URLSearchParams({
    action: "parse",
    format: "json",
    page,
    prop: "text|revid",
  });

  const response = await fetch(`${LEAGUEPEDIA_API}?${query.toString()}`, {
    next: { revalidate: 900 },
    headers: {
      "user-agent": "lcs-fantasy-friends-app/0.1 (+self-hosted)",
    },
  });

  if (!response.ok) {
    throw new Error(`Leaguepedia request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as ParseResponse;
  if ("error" in payload) {
    throw new Error(`Leaguepedia parse error: ${payload.error.info}`);
  }

  return {
    page: toPageKey(payload.parse.title || page),
    revisionId: typeof payload.parse.revid === "number" ? payload.parse.revid : null,
    html: payload.parse.text["*"],
  };
};

const hashRevisionString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const buildCompositeRevisionId = (pages: ParsedPagePayload[]): number | null => {
  if (pages.length === 0) {
    return null;
  }

  if (pages.length === 1) {
    return pages[0].revisionId;
  }

  const descriptor = pages
    .map((entry) => `${entry.page}:${entry.revisionId ?? "null"}`)
    .sort((a, b) => a.localeCompare(b))
    .join("|");

  return hashRevisionString(descriptor);
};

const dedupeGamesById = (games: ParsedGame[]): ParsedGame[] => {
  const seen = new Set<string>();
  const unique: ParsedGame[] = [];

  for (const game of games) {
    if (seen.has(game.id)) {
      continue;
    }
    seen.add(game.id);
    unique.push(game);
  }

  return unique;
};

const readTeamInfo = (
  $: cheerio.CheerioAPI,
  header: cheerio.Cheerio<AnyNode>,
): { name: string; iconUrl: string | null; pageTitle: string | null } => {
  const anchor = header.find(".teamname a").first();
  const img = header.find("img").first();
  const pageTitle = normalizeWikiPageTitle(anchor.attr("href"));
  const iconUrl =
    normalizeImageUrl(img.attr("data-src")) ??
    normalizeImageUrl(img.attr("src")) ??
    firstUrlInSet(img.attr("data-srcset")) ??
    firstUrlInSet(img.attr("srcset"));

  if (anchor.length > 0) {
    return {
      name: normalizeText(anchor.text()),
      iconUrl,
      pageTitle,
    };
  }

  return {
    name: normalizeText($(header).text()),
    iconUrl,
    pageTitle,
  };
};

const extractPlayersForSide = (
  $: cheerio.CheerioAPI,
  table: cheerio.Cheerio<AnyNode>,
  side: TeamSide,
  team: string,
  winner: string | null,
): PlayerGameStat[] => {
  const roleOrder: PlayerRole[] = ["TOP", "JNG", "MID", "ADC", "SUP"];
  const players: PlayerGameStat[] = [];

  table.find(`td.side-${side} .sb-p`).each((index, element) => {
    const card = $(element);
    const name = normalizeText(card.find(".sb-p-name").first().text());
    const champion = normalizeText(
      card.find(".sb-p-champion [title]").first().attr("title") ?? "",
    );
    const kda = parseKda(card.find(".sb-p-stat-kda").first().text());

    if (!name || !kda) {
      return;
    }

    players.push({
      name,
      team,
      side,
      role: roleOrder[index] ?? "FLEX",
      champion: champion || "Unknown",
      kills: kda.kills,
      deaths: kda.deaths,
      assists: kda.assists,
      cs: extractInt(card.find(".sb-p-stat-cs").first().text()),
      gold: parseGold(card.find(".sb-p-stat-gold").first().text()),
      won: winner === team,
    });
  });

  return players;
};

const parseGameId = (
  rawId: string | undefined,
  blueTeam: string,
  redTeam: string,
  matchNumber: number,
): string => {
  if (!rawId) {
    return `${blueTeam}_vs_${redTeam}_${matchNumber}`.replace(/\s+/g, "_");
  }

  const split = rawId.split("id=");
  if (split.length < 2) {
    return rawId;
  }

  return split[1].replace(/\s+/g, "_");
};

const parseScoreboardHtml = (html: string): ParsedGame[] => {
  const $ = cheerio.load(html);
  const games: ParsedGame[] = [];

  $("table.sb").each((index, tableElement) => {
    const table = $(tableElement);
    const teamHeaders = table.find("tr").first().find("th.sb-teamname");
    if (teamHeaders.length < 2) {
      return;
    }

    const blueTeamInfo = readTeamInfo($, teamHeaders.eq(0));
    const redTeamInfo = readTeamInfo($, teamHeaders.eq(1));
    const blueTeam = blueTeamInfo.name;
    const redTeam = redTeamInfo.name;
    const matchNumber = index + 1;

    const summaryRow = table.find("tr.sb-allw").first();
    const summaryCells = summaryRow.find("th");
    const blueHeader = summaryCells.first();
    const redHeader = summaryCells.last();

    const blueStatus = normalizeText(
      blueHeader.find(".sb-header-vertict").first().text(),
    ).toLowerCase();
    const redStatus = normalizeText(
      redHeader.find(".sb-header-vertict").first().text(),
    ).toLowerCase();

    let winner: string | null = null;
    if (blueStatus.includes("victory")) {
      winner = blueTeam;
    }
    if (redStatus.includes("victory")) {
      winner = redTeam;
    }

    const duration = normalizeText(summaryCells.eq(1).text()) || null;
    const blueKills = extractInt(blueHeader.find(".sb-header-Kills").text());
    const redKills = extractInt(redHeader.find(".sb-header-Kills").text());

    const dateContainer = table.find(".sb-datetime").first();
    const playedAtRaw =
      normalizeText(dateContainer.find(".DateInLocal").first().text()) || null;
    const playedAtLabel = parseDateInLocalTuple(playedAtRaw);
    const patch =
      normalizeText(dateContainer.find(".sb-datetime-patch a").first().text()) ||
      normalizeText(dateContainer.find(".sb-datetime-patch").first().text()) ||
      null;
    const parseTextId = dateContainer
      .find("[data-parse-text*='ScoreboardExtraStats']")
      .first()
      .attr("data-parse-text");

    const gameId = parseGameId(parseTextId, blueTeam, redTeam, matchNumber);

    const bluePlayers = extractPlayersForSide($, table, "blue", blueTeam, winner);
    const redPlayers = extractPlayersForSide($, table, "red", redTeam, winner);

    if (bluePlayers.length === 0 && redPlayers.length === 0) {
      return;
    }

    games.push({
      id: gameId,
      matchNumber,
      blueTeam,
      redTeam,
      blueTeamPage: blueTeamInfo.pageTitle,
      redTeamPage: redTeamInfo.pageTitle,
      blueTeamIconUrl: blueTeamInfo.iconUrl,
      redTeamIconUrl: redTeamInfo.iconUrl,
      winner,
      duration,
      patch,
      playedAtRaw,
      playedAtLabel,
      blueKills,
      redKills,
      players: [...bluePlayers, ...redPlayers],
    });
  });

  return games;
};

export interface LeaguepediaScoreboardSnapshot {
  sourcePage: string;
  sourceRevisionId: number | null;
  fetchedAt: string;
  games: ParsedGame[];
}

export const fetchLeaguepediaSnapshot = async (
  page: string = DEFAULT_PAGE,
): Promise<LeaguepediaScoreboardSnapshot> => {
  const normalizedPage = normalizePageInput(page);
  const isSegmentedScoreboardRequest = normalizedPage.includes(
    `${SCOREBOARDS_SEGMENT}/`,
  );

  const rootPayload = await fetchParsedPagePayload(normalizedPage);

  const parsedPages: ParsedPagePayload[] = [rootPayload];
  const parsedGames = parseScoreboardHtml(rootPayload.html);

  if (!isSegmentedScoreboardRequest) {
    const queue = readScoreboardLinksFromHtml(rootPayload.html, normalizedPage);
    const seenPages = new Set<string>([rootPayload.page, normalizedPage]);

    while (queue.length > 0) {
      const nextPage = queue.shift();
      if (!nextPage || seenPages.has(nextPage)) {
        continue;
      }

      seenPages.add(nextPage);
      const pagePayload = await fetchParsedPagePayload(nextPage);
      parsedPages.push(pagePayload);
      parsedGames.push(...parseScoreboardHtml(pagePayload.html));

      const nestedLinks = readScoreboardLinksFromHtml(
        pagePayload.html,
        normalizedPage,
      );

      for (const linkedPage of nestedLinks) {
        if (!seenPages.has(linkedPage)) {
          queue.push(linkedPage);
        }
      }
    }
  }

  const uniqueGames = dedupeGamesById(parsedGames);
  if (uniqueGames.length === 0) {
    throw new Error("No game tables were parsed from the configured source page(s).");
  }

  return {
    sourcePage: normalizedPage,
    sourceRevisionId: buildCompositeRevisionId(parsedPages),
    fetchedAt: new Date().toISOString(),
    games: uniqueGames,
  };
};

export const fetchLeaguepediaScoreboard = async (
  page: string = DEFAULT_PAGE,
): Promise<ParsedGame[]> => {
  const snapshot = await fetchLeaguepediaSnapshot(page);
  return snapshot.games;
};
