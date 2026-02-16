const LEAGUEPEDIA_API = "https://lol.fandom.com/api.php";
const REQUEST_HEADERS = {
  "user-agent": "lcs-fantasy-friends-app/0.1 (+self-hosted)",
} as const;
const PAGE_IMAGE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PAGE_IMAGE_REVALIDATE_SECONDS = 6 * 60 * 60;
const PAGE_IMAGE_BATCH_SIZE = 24;

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

const pageImageCache = new Map<string, CachedPageImage>();

const normalizeText = (value: string): string =>
  value.replace(/\s+/g, " ").replace(/\u00a0/g, " ").trim();

const normalizeTitleKey = (value: string): string => {
  const normalized = normalizeText(value).replace(/_/g, " ");
  return normalized.toLowerCase();
};

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
      piprop: "thumbnail",
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
  const requestTitlePreferences = requests.map((request) => {
    const normalizedTitles = request.lookupTitles
      .map((title) => (title ? normalizeTitleKey(title) : ""))
      .filter((title, index, all) => Boolean(title) && all.indexOf(title) === index);
    for (const title of normalizedTitles) {
      if (readCachedImage(title) === undefined) {
        normalizedTitlesToFetch.add(title);
      }
    }
    return {
      key: request.key,
      normalizedTitles,
    };
  });

  if (normalizedTitlesToFetch.size > 0) {
    const fetched = await fetchPageImagesForTitles([...normalizedTitlesToFetch.values()]);
    for (const title of normalizedTitlesToFetch.values()) {
      writeCachedImage(title, fetched.get(title) ?? null);
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
