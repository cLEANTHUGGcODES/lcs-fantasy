import leagueConfigData from "@/data/friends-league.json";
import { resolveScoringConfig } from "@/lib/fantasy";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { FantasyScoring, LeagueConfig } from "@/types/fantasy";

const SETTINGS_TABLE =
  process.env.SUPABASE_SCORING_SETTINGS_TABLE ?? "fantasy_scoring_settings";
const SETTINGS_ROW_ID = 1;
const MIN_SCORING_VALUE = -100;
const MAX_SCORING_VALUE = 100;
const ROUND_FACTOR = 1000;
const scoringFields = [
  "kill",
  "death",
  "assist",
  "win",
  "csPer100",
  "goldPer1000",
] as const;

type ScoringField = (typeof scoringFields)[number];
type SettingsSource = "default" | "database";

type ScoringSettingsRow = {
  id: number;
  scoring: unknown;
  updated_at: string;
};

const leagueConfig = leagueConfigData as LeagueConfig;
const fallbackScoring = resolveScoringConfig(leagueConfig.scoring);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const roundScoringValue = (value: number): number =>
  Math.round((value + Number.EPSILON) * ROUND_FACTOR) / ROUND_FACTOR;

const parseStoredScoring = (value: unknown): Partial<FantasyScoring> => {
  if (!isObject(value)) {
    return {};
  }

  const parsed: Partial<FantasyScoring> = {};
  for (const field of scoringFields) {
    const rawValue = value[field];
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
      parsed[field] = roundScoringValue(rawValue);
    }
  }

  return parsed;
};

const toScoringPayload = (
  scoring: FantasyScoring,
): Record<ScoringField, number> => ({
  kill: roundScoringValue(scoring.kill),
  death: roundScoringValue(scoring.death),
  assist: roundScoringValue(scoring.assist),
  win: roundScoringValue(scoring.win),
  csPer100: roundScoringValue(scoring.csPer100),
  goldPer1000: roundScoringValue(scoring.goldPer1000),
});

const isMissingTableError = (code: string | undefined): boolean =>
  code === "42P01";

export const getDefaultScoringSettings = (): FantasyScoring => ({
  ...fallbackScoring,
});

export type ActiveScoringSettings = {
  scoring: FantasyScoring;
  updatedAt: string | null;
  source: SettingsSource;
};

const ACTIVE_SCORING_CACHE_TTL_MS = 5_000;
let cachedActiveScoringSettings:
  | {
      value: ActiveScoringSettings;
      expiresAtMs: number;
    }
  | null = null;
let inFlightActiveScoringSettingsPromise: Promise<ActiveScoringSettings> | null = null;

const cloneActiveScoringSettings = (
  value: ActiveScoringSettings,
): ActiveScoringSettings => ({
  scoring: { ...value.scoring },
  updatedAt: value.updatedAt,
  source: value.source,
});

const loadActiveScoringSettingsFromDatabase = async (): Promise<ActiveScoringSettings> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .select("id,scoring,updated_at")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle<ScoringSettingsRow>();

  if (error) {
    if (isMissingTableError(error.code)) {
      return {
        scoring: getDefaultScoringSettings(),
        updatedAt: null,
        source: "default",
      };
    }

    throw new Error(`Unable to load scoring settings: ${error.message}`);
  }

  if (!data) {
    return {
      scoring: getDefaultScoringSettings(),
      updatedAt: null,
      source: "default",
    };
  }

  return {
    scoring: {
      ...fallbackScoring,
      ...parseStoredScoring(data.scoring),
    },
    updatedAt: data.updated_at,
    source: "database",
  };
};

export const getActiveScoringSettings = async (): Promise<ActiveScoringSettings> => {
  const nowMs = Date.now();
  if (cachedActiveScoringSettings && cachedActiveScoringSettings.expiresAtMs > nowMs) {
    return cloneActiveScoringSettings(cachedActiveScoringSettings.value);
  }

  if (!inFlightActiveScoringSettingsPromise) {
    inFlightActiveScoringSettingsPromise = loadActiveScoringSettingsFromDatabase()
      .then((value) => {
        cachedActiveScoringSettings = {
          value,
          expiresAtMs: Date.now() + ACTIVE_SCORING_CACHE_TTL_MS,
        };
        return value;
      })
      .finally(() => {
        inFlightActiveScoringSettingsPromise = null;
      });
  }

  const resolved = await inFlightActiveScoringSettingsPromise;
  return cloneActiveScoringSettings(resolved);
};

export const validateScoringSettingsInput = (
  value: unknown,
):
  | { ok: true; scoring: FantasyScoring }
  | { ok: false; error: string } => {
  if (!isObject(value)) {
    return {
      ok: false,
      error: "Scoring payload must be an object.",
    };
  }

  const parsed = {} as Record<ScoringField, number>;
  for (const field of scoringFields) {
    const raw = value[field];
    const numeric =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && raw.trim().length > 0
          ? Number(raw)
          : Number.NaN;

    if (!Number.isFinite(numeric)) {
      return {
        ok: false,
        error: `${field} must be a valid number.`,
      };
    }

    if (numeric < MIN_SCORING_VALUE || numeric > MAX_SCORING_VALUE) {
      return {
        ok: false,
        error: `${field} must be between ${MIN_SCORING_VALUE} and ${MAX_SCORING_VALUE}.`,
      };
    }

    parsed[field] = roundScoringValue(numeric);
  }

  return {
    ok: true,
    scoring: {
      kill: parsed.kill,
      death: parsed.death,
      assist: parsed.assist,
      win: parsed.win,
      csPer100: parsed.csPer100,
      goldPer1000: parsed.goldPer1000,
    },
  };
};

export const saveScoringSettings = async ({
  scoring,
  updatedByUserId,
}: {
  scoring: FantasyScoring;
  updatedByUserId?: string;
}): Promise<{ scoring: FantasyScoring; updatedAt: string }> => {
  const supabase = getSupabaseServerClient();
  const normalizedScoring = {
    ...fallbackScoring,
    ...toScoringPayload(scoring),
  };
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from(SETTINGS_TABLE)
    .upsert(
      {
        id: SETTINGS_ROW_ID,
        scoring: toScoringPayload(normalizedScoring),
        updated_at: updatedAt,
        updated_by_user_id: updatedByUserId ?? null,
      },
      { onConflict: "id" },
    )
    .select("scoring,updated_at")
    .single<Pick<ScoringSettingsRow, "scoring" | "updated_at">>();

  if (error) {
    if (isMissingTableError(error.code)) {
      throw new Error(
        `Unable to save scoring settings because table "${SETTINGS_TABLE}" does not exist. Apply supabase/schema.sql and retry.`,
      );
    }

    throw new Error(`Unable to save scoring settings: ${error.message}`);
  }

  const resolved = {
    scoring: {
      ...fallbackScoring,
      ...parseStoredScoring(data.scoring),
    },
    updatedAt: data.updated_at,
  };

  cachedActiveScoringSettings = {
    value: {
      scoring: { ...resolved.scoring },
      updatedAt: resolved.updatedAt,
      source: "database",
    },
    expiresAtMs: Date.now() + ACTIVE_SCORING_CACHE_TTL_MS,
  };

  return resolved;
};
