const LEAGUEPEDIA_API = "https://lol.fandom.com/api.php";
const REQUEST_HEADERS = {
  "user-agent": "lcs-fantasy-friends-app/0.1 (+self-hosted)",
} as const;
const PAGE_IMAGE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PAGE_IMAGE_REVALIDATE_SECONDS = 6 * 60 * 60;
const PAGE_IMAGE_BATCH_SIZE = 24;
const PAGE_SEARCH_REVALIDATE_SECONDS = 6 * 60 * 60;
const PAGE_SEARCH_BATCH_SIZE = 8;
const DISAMBIGUATION_SEARCH_LIMIT = 8;

type LeaguepediaPageImageResponse = {
  query?: {
    redirects?: {
      from?: string;
      to?: string;
    }[];
    pages?: Record<
      string,
      {
        title?: string;
        thumbnail?: { source?: string };
        original?: { source?: string };
      }
    >;
  };
  error?: {
    info?: string;
  };
};

type CachedPageImage = {
  imageUrl: string | null;
  expiresAtMs: number;
};

type LeaguepediaOpenSearchResponse = [string, string[], string[], string[]];

const pageImageCache = new Map<string, CachedPageImage>();

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const normalizeTitleKey = (value: string): string => {
  const normalized = normalizeText(value).replace(/_/g, " ");
  return normalized.toLowerCase();
};

const normalizeTitleForQuery = (value: string): string =>
  normalizeText(value).replace(/_/g, " ");

const normalizeImageUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }
  const cleaned = value.trim();
  if (!cleaned || cleaned.toLowerCase().startsWith("data:image/")) {
    return null;
  }
  if (cleaned.startsWith("//")) {
    return `https:${cleaned}`;
  }
  return cleaned;
};

const chunk = <T>(values: T[], size: number): T[][] => {
  if (values.length === 0) {
    return [];
  }
  const groups: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
};

const isLikelyDisambiguationAlias = (normalizedTitle: string): boolean => {
  const title = normalizedTitle.trim();
  if (!title) {
    return false;
  }
  if (
    title.includes("(") ||
    title.includes(")") ||
    title.includes("/") ||
    title.includes(":")
  ) {
    return false;
  }
  return title.length <= 40;
};

const readCachedImage = (normalizedTitle: string): string | null | undefined => {
  const cached = pageImageCache.get(normalizedTitle);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAtMs < Date.now()) {
    pageImageCache.delete(normalizedTitle);
    return undefined;
  }
  return cached.imageUrl;
};

const writeCachedImage = (normalizedTitle: string, imageUrl: string | null): void => {
  pageImageCache.set(normalizedTitle, {
    imageUrl,
    expiresAtMs: Date.now() + PAGE_IMAGE_CACHE_TTL_MS,
  });
};

const fetchPageImagesForTitles = async (
  titles: string[],
): Promise<Map<string, string | null>> => {
  const byNormalizedTitle = new Map<string, string | null>();
  if (titles.length === 0) {
    return byNormalizedTitle;
  }

  for (const titleGroup of chunk(titles, PAGE_IMAGE_BATCH_SIZE)) {
    const query = new URLSearchParams({
      action: "query",
      format: "json",
      redirects: "1",
      prop: "pageimages",
      piprop: "thumbnail|original",
      pithumbsize: "220",
      titles: titleGroup.join("|"),
    });
    const response = await fetch(`${LEAGUEPEDIA_API}?${query.toString()}`, {
      next: { revalidate: PAGE_IMAGE_REVALIDATE_SECONDS },
      headers: REQUEST_HEADERS,
    });

    if (!response.ok) {
      throw new Error(`Leaguepedia image lookup failed (${response.status}).`);
    }

    const payload = (await response.json()) as LeaguepediaPageImageResponse;
    if (payload.error) {
      throw new Error(payload.error.info ?? "Leaguepedia image lookup failed.");
    }

    const redirectsByFrom = new Map<string, string>();
    for (const redirect of payload.query?.redirects ?? []) {
      const fromKey = redirect.from ? normalizeTitleKey(redirect.from) : "";
      const toKey = redirect.to ? normalizeTitleKey(redirect.to) : "";
      if (fromKey && toKey) {
        redirectsByFrom.set(fromKey, toKey);
      }
    }

    for (const page of Object.values(payload.query?.pages ?? {})) {
      const normalizedTitle = page.title ? normalizeTitleKey(page.title) : "";
      if (!normalizedTitle) {
        continue;
      }
      const imageUrl =
        normalizeImageUrl(page.thumbnail?.source) ??
        normalizeImageUrl(page.original?.source) ??
        null;
      byNormalizedTitle.set(normalizedTitle, imageUrl);
    }

    for (const [fromKey, toKey] of redirectsByFrom.entries()) {
      const resolvedImage = byNormalizedTitle.get(toKey) ?? null;
      byNormalizedTitle.set(fromKey, resolvedImage);
    }
  }

  return byNormalizedTitle;
};

const fetchOpenSearchCandidates = async (searchTerm: string): Promise<string[]> => {
  const query = new URLSearchParams({
    action: "opensearch",
    format: "json",
    search: searchTerm,
    namespace: "0",
    limit: `${DISAMBIGUATION_SEARCH_LIMIT}`,
  });

  const response = await fetch(`${LEAGUEPEDIA_API}?${query.toString()}`, {
    next: { revalidate: PAGE_SEARCH_REVALIDATE_SECONDS },
    headers: REQUEST_HEADERS,
  });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as LeaguepediaOpenSearchResponse | { error?: unknown };
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) {
    return [];
  }

  return payload[1]
    .map((entry) => normalizeText(entry).replace(/_/g, " "))
    .filter((entry, index, all) => Boolean(entry) && all.indexOf(entry) === index);
};

const pickDisambiguatedTitle = ({
  aliasTitle,
  candidates,
}: {
  aliasTitle: string;
  candidates: string[];
}): string | null => {
  const normalizedAlias = normalizeTitleKey(aliasTitle);
  if (!normalizedAlias) {
    return null;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeTitleKey(candidate);
    if (!normalizedCandidate || normalizedCandidate === normalizedAlias) {
      continue;
    }
    if (
      normalizedCandidate.startsWith(`${normalizedAlias} (`) &&
      normalizedCandidate.endsWith(")")
    ) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeTitleKey(candidate);
    if (!normalizedCandidate || normalizedCandidate === normalizedAlias) {
      continue;
    }
    if (normalizedCandidate.startsWith(`${normalizedAlias} `)) {
      return candidate;
    }
  }

  return null;
};

const resolveDisambiguatedTitles = async (
  aliasTitles: string[],
): Promise<Map<string, string>> => {
  const resolved = new Map<string, string>();
  if (aliasTitles.length === 0) {
    return resolved;
  }

  for (const titleGroup of chunk(aliasTitles, PAGE_SEARCH_BATCH_SIZE)) {
    const results = await Promise.all(
      titleGroup.map(async (aliasTitle) => {
        const candidates = await fetchOpenSearchCandidates(aliasTitle);
        const disambiguated = pickDisambiguatedTitle({
          aliasTitle,
          candidates,
        });
        return {
          aliasKey: normalizeTitleKey(aliasTitle),
          disambiguated,
        };
      }),
    );

    for (const result of results) {
      if (!result.aliasKey || !result.disambiguated) {
        continue;
      }
      resolved.set(result.aliasKey, result.disambiguated);
    }
  }

  return resolved;
};

export type PlayerImageLookupRequest = {
  key: string;
  lookupTitles: Array<string | null | undefined>;
};

export const resolveLeaguepediaPlayerImages = async (
  requests: PlayerImageLookupRequest[],
): Promise<Map<string, string>> => {
  if (requests.length === 0) {
    return new Map();
  }

  const normalizedTitlesToFetch = new Set<string>();
  const queryTitleByNormalizedKey = new Map<string, string>();
  const requestTitlePreferences = requests.map((request) => {
    const titleCandidates = request.lookupTitles
      .map((title) => {
        const queryTitle = title ? normalizeTitleForQuery(title) : "";
        const normalizedTitle = queryTitle ? normalizeTitleKey(queryTitle) : "";
        return {
          normalizedTitle,
          queryTitle,
        };
      })
      .filter(
        (entry, index, all) =>
          Boolean(entry.normalizedTitle) &&
          all.findIndex((candidate) => candidate.normalizedTitle === entry.normalizedTitle) === index,
      );
    const normalizedTitles = titleCandidates.map((entry) => entry.normalizedTitle);

    for (const { normalizedTitle, queryTitle } of titleCandidates) {
      if (!queryTitleByNormalizedKey.has(normalizedTitle)) {
        queryTitleByNormalizedKey.set(normalizedTitle, queryTitle);
      }
      if (readCachedImage(normalizedTitle) === undefined) {
        normalizedTitlesToFetch.add(normalizedTitle);
      }
    }
    return {
      key: request.key,
      normalizedTitles,
    };
  });

  if (normalizedTitlesToFetch.size > 0) {
    const titlesForLookup = [...normalizedTitlesToFetch.values()].map(
      (normalizedTitle) => queryTitleByNormalizedKey.get(normalizedTitle) ?? normalizedTitle,
    );
    const fetched = await fetchPageImagesForTitles(titlesForLookup);
    for (const title of normalizedTitlesToFetch.values()) {
      writeCachedImage(title, fetched.get(title) ?? null);
    }

    const unresolvedAliases = [...normalizedTitlesToFetch.values()].filter((title) => {
      if (!isLikelyDisambiguationAlias(title)) {
        return false;
      }
      return fetched.get(title) === undefined || fetched.get(title) === null;
    });

    if (unresolvedAliases.length > 0) {
      const disambiguatedByAlias = await resolveDisambiguatedTitles(unresolvedAliases);
      if (disambiguatedByAlias.size > 0) {
        const disambiguatedTitles = [...new Set(disambiguatedByAlias.values())];
        const disambiguatedImages = await fetchPageImagesForTitles(disambiguatedTitles);

        for (const [aliasKey, disambiguatedTitle] of disambiguatedByAlias.entries()) {
          const disambiguatedKey = normalizeTitleKey(disambiguatedTitle);
          const resolvedImage =
            disambiguatedImages.get(disambiguatedKey) ??
            readCachedImage(disambiguatedKey) ??
            null;
          if (resolvedImage) {
            writeCachedImage(aliasKey, resolvedImage);
          }
        }
      }
    }
  }

  const byKey = new Map<string, string>();
  for (const request of requestTitlePreferences) {
    for (const title of request.normalizedTitles) {
      const resolved = readCachedImage(title);
      if (typeof resolved === "string" && resolved) {
        byKey.set(request.key, resolved);
        break;
      }
    }
  }

  return byKey;
};
