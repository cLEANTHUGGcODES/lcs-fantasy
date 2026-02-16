#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_SCORING = {
  kill: 3,
  death: -1,
  assist: 2,
  win: 0,
  csPer100: 1,
  goldPer1000: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const BYE_USER_ID = "__BYE__";
const ENV_PATH = path.join(process.cwd(), ".env.local");
const MAX_RANDOM_ITERS = 40_000;
const SEARCH_RANGES = {
  kill: { min: 2.0, max: 4.5 },
  death: { min: -1.6, max: -0.25 },
  assist: { min: 1.0, max: 3.4 },
  win: { min: 0.0, max: 2.0 },
  csPer100: { min: 0.0, max: 2.2 },
  goldPer1000: { min: 0.0, max: 0.8 },
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    applyMode: "none",
  };

  for (const arg of args) {
    if (arg === "--apply") {
      options.applyMode = "best";
    }
    if (arg === "--apply-best") {
      options.applyMode = "best";
    }
    if (arg === "--apply-balanced") {
      options.applyMode = "balanced";
    }
  }

  return options;
};

const loadEnvFile = () => {
  if (!fs.existsSync(ENV_PATH)) {
    return;
  }

  const lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 1) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    const rawValue = trimmed.slice(eqIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
};

const normalizeName = (value) => (value ?? "").trim().toLowerCase();
const normalizeTeam = (value) => (value ?? "").trim().toLowerCase();

const roundTo = (value, step) => Math.round(value / step) * step;
const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const mean = (values) =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const percentile = (values, p) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rawIndex = Math.floor((sorted.length - 1) * p);
  const index = Math.min(sorted.length - 1, Math.max(0, rawIndex));
  return sorted[index];
};

const parseDateKeyUtc = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const pad2 = (value) => `${value}`.padStart(2, "0");

const toDateKeyUtc = (value) =>
  `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`;

const addDaysToDateKey = (dateKey, days) => {
  const parsed = parseDateKeyUtc(dateKey);
  if (!parsed) {
    return dateKey;
  }

  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toDateKeyUtc(parsed);
};

const dateKeyDayIndex = (value) => {
  const parsed = parseDateKeyUtc(value);
  if (!parsed) {
    return 0;
  }
  return Math.floor(parsed.getTime() / DAY_MS);
};

const wednesdayOnOrBefore = (dateKey) => {
  const parsed = parseDateKeyUtc(dateKey);
  if (!parsed) {
    return dateKey;
  }

  while (parsed.getUTCDay() !== 3) {
    parsed.setUTCDate(parsed.getUTCDate() - 1);
  }

  return toDateKeyUtc(parsed);
};

const getWeekBounds = (weekOneStartKey, weekNumber) => {
  const offset = Math.max(0, weekNumber - 1) * 7;
  const startsOn = addDaysToDateKey(weekOneStartKey, offset);
  const endsOn = addDaysToDateKey(startsOn, 5);
  return { startsOn, endsOn };
};

const extractGameDateKey = (game) => {
  if (game?.playedAtLabel) {
    const labelMatch = /^(\d{4}-\d{2}-\d{2})/.exec(game.playedAtLabel);
    if (labelMatch) {
      return labelMatch[1];
    }
  }

  if (game?.playedAtRaw) {
    const parts = String(game.playedAtRaw)
      .split(",")
      .map((entry) => Number.parseInt(entry.trim(), 10));
    if (
      parts.length >= 3 &&
      Number.isFinite(parts[0]) &&
      Number.isFinite(parts[1]) &&
      Number.isFinite(parts[2]) &&
      parts[1] >= 1 &&
      parts[1] <= 12 &&
      parts[2] >= 1 &&
      parts[2] <= 31
    ) {
      return `${parts[0]}-${pad2(parts[1])}-${pad2(parts[2])}`;
    }
  }

  return null;
};

const stripTeamSuffixFromName = (name, team) => {
  const normalized = (name ?? "").trim();
  if (!team) {
    return normalized;
  }

  const suffix = ` (${String(team).trim()})`;
  if (normalized.endsWith(suffix)) {
    return normalized.slice(0, -suffix.length).trim();
  }

  return normalized;
};

const buildRoundRobinRounds = (participantUserIds) => {
  if (participantUserIds.length < 2) {
    return [];
  }

  const seed = [...participantUserIds];
  if (seed.length % 2 === 1) {
    seed.push(BYE_USER_ID);
  }

  const rounds = [];
  let rotation = [...seed];
  const roundCount = rotation.length - 1;
  const pairsPerRound = rotation.length / 2;

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const pairs = [];
    for (let pairIndex = 0; pairIndex < pairsPerRound; pairIndex += 1) {
      const left = rotation[pairIndex];
      const right = rotation[rotation.length - 1 - pairIndex];
      if (left && right) {
        pairs.push([left, right]);
      }
    }
    rounds.push(pairs);

    const anchor = rotation[0];
    const movable = rotation.slice(1);
    const tail = movable.pop();
    if (!anchor || !tail) {
      break;
    }
    rotation = [anchor, tail, ...movable];
  }

  return rounds;
};

const zeroFeatures = () => ({
  kill: 0,
  death: 0,
  assist: 0,
  win: 0,
  csPer100: 0,
  goldPer1000: 0,
});

const addFeatures = (left, right) => ({
  kill: left.kill + right.kill,
  death: left.death + right.death,
  assist: left.assist + right.assist,
  win: left.win + right.win,
  csPer100: left.csPer100 + right.csPer100,
  goldPer1000: left.goldPer1000 + right.goldPer1000,
});

const subFeatures = (left, right) => ({
  kill: left.kill - right.kill,
  death: left.death - right.death,
  assist: left.assist - right.assist,
  win: left.win - right.win,
  csPer100: left.csPer100 - right.csPer100,
  goldPer1000: left.goldPer1000 - right.goldPer1000,
});

const dot = (features, scoring) =>
  features.kill * scoring.kill +
  features.death * scoring.death +
  features.assist * scoring.assist +
  features.win * scoring.win +
  features.csPer100 * scoring.csPer100 +
  features.goldPer1000 * scoring.goldPer1000;

const buildWeeklyPlayerFeatureTotals = (games) => {
  const byName = new Map();
  const byNameAndTeam = new Map();

  for (const game of games) {
    for (const player of game.players ?? []) {
      const playerName = (player.name ?? "").trim();
      const playerTeam = (player.team ?? "").trim();
      if (!playerName || !playerTeam) {
        continue;
      }

      const nameKey = normalizeName(playerName);
      const teamKey = normalizeTeam(playerTeam);
      const compositeKey = `${nameKey}::${teamKey}`;

      const existing = byNameAndTeam.get(compositeKey) ?? {
        player: playerName,
        team: playerTeam,
        features: zeroFeatures(),
      };

      existing.features.kill += Number(player.kills ?? 0);
      existing.features.death += Number(player.deaths ?? 0);
      existing.features.assist += Number(player.assists ?? 0);
      existing.features.win += player.won ? 1 : 0;
      existing.features.csPer100 += player.cs ? Number(player.cs) / 100 : 0;
      existing.features.goldPer1000 += player.gold ? Number(player.gold) / 1000 : 0;

      byNameAndTeam.set(compositeKey, existing);
    }
  }

  for (const entry of byNameAndTeam.values()) {
    const nameKey = normalizeName(entry.player);
    const list = byName.get(nameKey) ?? [];
    list.push(entry);
    byName.set(nameKey, list);
  }

  return { byName, byNameAndTeam };
};

const resolvePickFeatureEntry = ({ pick, byName, byNameAndTeam }) => {
  const baseName = stripTeamSuffixFromName(pick.team_name, pick.player_team);
  const nameKey = normalizeName(baseName);

  if (pick.player_team) {
    const teamKey = normalizeTeam(pick.player_team);
    const compositeKey = `${nameKey}::${teamKey}`;
    const exact = byNameAndTeam.get(compositeKey);
    if (exact) {
      return exact;
    }
  }

  const candidates = byName.get(nameKey) ?? [];
  if (candidates.length === 1) {
    return candidates[0];
  }

  return null;
};

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pickInRange = (random, min, max, step) => roundTo(min + random() * (max - min), step);

const optimize = ({
  baseScoring,
  matchupDiffVectors,
  teamFeatureVectors,
}) => {
  const baselineAvgTeamPoints = mean(teamFeatureVectors.map((entry) => dot(entry, baseScoring)));

  const evaluate = (scoring) => {
    const margins = matchupDiffVectors.map((entry) => Math.abs(dot(entry, scoring)));
    const avgTeamPoints = mean(teamFeatureVectors.map((entry) => dot(entry, scoring)));
    const meanMargin = mean(margins);
    const medianMargin = percentile(margins, 0.5);
    const p90Margin = percentile(margins, 0.9);
    const relScale = baselineAvgTeamPoints > 0 ? avgTeamPoints / baselineAvgTeamPoints : 1;
    const invalid =
      !Number.isFinite(meanMargin) ||
      !Number.isFinite(avgTeamPoints) ||
      avgTeamPoints <= 0 ||
      relScale < 0.75 ||
      relScale > 1.35;

    return {
      scoring,
      meanMargin,
      medianMargin,
      p90Margin,
      avgTeamPoints,
      relScale,
      invalid,
    };
  };

  const results = [evaluate(baseScoring)];
  const random = mulberry32(20260216);

  for (let index = 0; index < MAX_RANDOM_ITERS; index += 1) {
    const candidate = {
      kill: pickInRange(random, 2.0, 4.5, 0.05),
      death: pickInRange(random, -1.6, -0.25, 0.05),
      assist: pickInRange(random, 1.0, 3.4, 0.05),
      win: pickInRange(random, 0.0, 2.0, 0.05),
      csPer100: pickInRange(random, 0.0, 2.2, 0.05),
      goldPer1000: pickInRange(random, 0.0, 0.8, 0.05),
    };

    if (candidate.kill < candidate.assist * 0.7) {
      continue;
    }
    if (candidate.kill - Math.abs(candidate.death) < 1.25) {
      continue;
    }

    const evaluated = evaluate(candidate);
    if (!evaluated.invalid) {
      results.push(evaluated);
    }
  }

  const valid = results.filter((entry) => !entry.invalid);
  valid.sort((left, right) => {
    if (left.meanMargin !== right.meanMargin) {
      return left.meanMargin - right.meanMargin;
    }
    if (left.p90Margin !== right.p90Margin) {
      return left.p90Margin - right.p90Margin;
    }
    return left.medianMargin - right.medianMargin;
  });

  const normalizedDistanceFromBaseline = (scoring) => {
    let sumSquares = 0;
    const keys = Object.keys(SEARCH_RANGES);
    for (const key of keys) {
      const { min, max } = SEARCH_RANGES[key];
      const span = Math.max(0.0001, max - min);
      const delta = (Number(scoring[key]) - Number(baseScoring[key] ?? 0)) / span;
      sumSquares += delta * delta;
    }
    return Math.sqrt(sumSquares / keys.length);
  };

  const baseline = evaluate(baseScoring);
  const eligibleBalanced = valid.filter(
    (entry) =>
      entry.meanMargin <= baseline.meanMargin * 0.85 &&
      entry.relScale >= 0.8 &&
      entry.relScale <= 1.2,
  );
  const balancedPool = eligibleBalanced.length > 0 ? eligibleBalanced : valid;
  const bestBalanced = [...balancedPool].sort((left, right) => {
    const leftScore =
      left.meanMargin / Math.max(0.0001, baseline.meanMargin) +
      normalizedDistanceFromBaseline(left.scoring) * 0.45;
    const rightScore =
      right.meanMargin / Math.max(0.0001, baseline.meanMargin) +
      normalizedDistanceFromBaseline(right.scoring) * 0.45;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    return left.meanMargin - right.meanMargin;
  })[0];

  return {
    baseline,
    best: valid[0],
    bestBalanced,
    top5: valid.slice(0, 5),
  };
};

const main = async () => {
  const options = parseArgs();
  loadEnvFile();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const snapshotsTable =
    process.env.SUPABASE_MATCH_SNAPSHOTS_TABLE ?? "fantasy_match_snapshots";
  const scoringSettingsTable =
    process.env.SUPABASE_SCORING_SETTINGS_TABLE ?? "fantasy_scoring_settings";

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: completedDraft, error: draftError } = await supabase
    .from("fantasy_drafts")
    .select("id,name,source_page,started_at,scheduled_at")
    .eq("status", "completed")
    .order("started_at", { ascending: false, nullsFirst: false })
    .order("scheduled_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (draftError) {
    throw new Error(`Unable to load completed draft: ${draftError.message}`);
  }
  if (!completedDraft) {
    throw new Error("No completed draft found.");
  }

  const { data: participants, error: participantsError } = await supabase
    .from("fantasy_draft_participants")
    .select("user_id,display_name,team_name,draft_position")
    .eq("draft_id", completedDraft.id)
    .order("draft_position", { ascending: true });
  if (participantsError) {
    throw new Error(`Unable to load draft participants: ${participantsError.message}`);
  }

  const { data: picks, error: picksError } = await supabase
    .from("fantasy_draft_picks")
    .select("participant_user_id,team_name,player_team,player_role,team_icon_url")
    .eq("draft_id", completedDraft.id)
    .order("overall_pick", { ascending: true });
  if (picksError) {
    throw new Error(`Unable to load draft picks: ${picksError.message}`);
  }

  const { data: snapshotRow, error: snapshotError } = await supabase
    .from(snapshotsTable)
    .select("source_page,games,stored_at")
    .eq("source_page", completedDraft.source_page)
    .order("stored_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (snapshotError) {
    throw new Error(`Unable to load latest snapshot: ${snapshotError.message}`);
  }
  if (!snapshotRow) {
    throw new Error(`No snapshot found for source page "${completedDraft.source_page}".`);
  }

  const payload = typeof snapshotRow.games === "string" ? JSON.parse(snapshotRow.games) : snapshotRow.games;
  const games = Array.isArray(payload?.games) ? payload.games : [];
  if (games.length === 0) {
    throw new Error("Snapshot payload does not contain games.");
  }

  const baseScoring = {
    ...DEFAULT_SCORING,
    ...(payload?.scoring ?? {}),
  };

  const participantUserIds = (participants ?? []).map((entry) => entry.user_id);
  const rounds = buildRoundRobinRounds(participantUserIds);
  if (rounds.length === 0) {
    throw new Error("Unable to build round robin schedule from current participants.");
  }

  const picksByUserId = new Map();
  for (const pick of picks ?? []) {
    const list = picksByUserId.get(pick.participant_user_id) ?? [];
    list.push(pick);
    picksByUserId.set(pick.participant_user_id, list);
  }

  let earliestGameDateKey = null;
  let latestGameDateKey = null;
  for (const game of games) {
    const dateKey = extractGameDateKey(game);
    if (!dateKey) {
      continue;
    }
    if (!earliestGameDateKey || dateKey < earliestGameDateKey) {
      earliestGameDateKey = dateKey;
    }
    if (!latestGameDateKey || dateKey > latestGameDateKey) {
      latestGameDateKey = dateKey;
    }
  }
  if (!earliestGameDateKey || !latestGameDateKey) {
    throw new Error("Unable to derive date keys from parsed games.");
  }

  const draftAnchorDate = (() => {
    const date = new Date(completedDraft.started_at ?? completedDraft.scheduled_at);
    if (Number.isNaN(date.getTime())) {
      return earliestGameDateKey;
    }
    return toDateKeyUtc(date);
  })();
  const weekAnchorKey =
    earliestGameDateKey < draftAnchorDate ? earliestGameDateKey : draftAnchorDate;
  const weekOneStartKey = wednesdayOnOrBefore(weekAnchorKey);
  const maxWeekNumber = Math.max(
    1,
    Math.floor(
      (dateKeyDayIndex(latestGameDateKey) - dateKeyDayIndex(weekOneStartKey)) / 7,
    ) + 1,
  );

  const matchupDiffVectors = [];
  const teamFeatureVectors = [];

  for (let weekNumber = 1; weekNumber <= maxWeekNumber; weekNumber += 1) {
    const { startsOn, endsOn } = getWeekBounds(weekOneStartKey, weekNumber);
    const weeklyGames = games.filter((game) => {
      const gameDateKey = extractGameDateKey(game);
      return gameDateKey ? gameDateKey >= startsOn && gameDateKey <= endsOn : false;
    });
    if (weeklyGames.length === 0) {
      continue;
    }

    const { byName, byNameAndTeam } = buildWeeklyPlayerFeatureTotals(weeklyGames);
    const teamByUserId = new Map();

    for (const userId of participantUserIds) {
      const userPicks = picksByUserId.get(userId) ?? [];
      let features = zeroFeatures();
      for (const pick of userPicks) {
        const resolved = resolvePickFeatureEntry({
          pick,
          byName,
          byNameAndTeam,
        });
        if (!resolved) {
          continue;
        }
        features = addFeatures(features, resolved.features);
      }
      teamByUserId.set(userId, features);
      teamFeatureVectors.push(features);
    }

    const weekPairs = rounds[(weekNumber - 1) % rounds.length] ?? [];
    for (const [leftUserId, rightUserId] of weekPairs) {
      if (leftUserId === BYE_USER_ID || rightUserId === BYE_USER_ID) {
        continue;
      }
      const leftFeatures = teamByUserId.get(leftUserId) ?? zeroFeatures();
      const rightFeatures = teamByUserId.get(rightUserId) ?? zeroFeatures();
      matchupDiffVectors.push(subFeatures(leftFeatures, rightFeatures));
    }
  }

  if (matchupDiffVectors.length === 0) {
    throw new Error("No matchup vectors were generated from current data.");
  }

  const optimized = optimize({
    baseScoring,
    matchupDiffVectors,
    teamFeatureVectors,
  });

  if (!optimized.best) {
    throw new Error("Optimization did not produce any valid candidate.");
  }

  const scoringToApply =
    options.applyMode === "balanced"
      ? optimized.bestBalanced?.scoring ?? optimized.best.scoring
      : optimized.best.scoring;

  if (options.applyMode !== "none") {
    const nowIso = new Date().toISOString();
    const { error: upsertError } = await supabase
      .from(scoringSettingsTable)
      .upsert({
        id: 1,
        scoring: {
          ...scoringToApply,
        },
        updated_at: nowIso,
      });

    if (upsertError) {
      throw new Error(`Unable to apply best scoring settings: ${upsertError.message}`);
    }
  }

  const baseline = optimized.baseline;
  const best = optimized.best;
  const marginImprovementPct =
    baseline.meanMargin > 0
      ? ((baseline.meanMargin - best.meanMargin) / baseline.meanMargin) * 100
      : 0;

  const result = {
    applied: options.applyMode !== "none",
    appliedMode: options.applyMode,
    appliedScoring:
      options.applyMode !== "none"
        ? {
            ...scoringToApply,
          }
        : null,
    draft: {
      id: completedDraft.id,
      name: completedDraft.name,
      sourcePage: completedDraft.source_page,
    },
    sample: {
      weekOneStart: weekOneStartKey,
      latestGameDate: latestGameDateKey,
      matchupCount: matchupDiffVectors.length,
      teamScoreSamples: teamFeatureVectors.length,
      maxWeekNumber,
      randomIterations: MAX_RANDOM_ITERS,
    },
    baseline: {
      scoring: baseline.scoring,
      meanMargin: round2(baseline.meanMargin),
      medianMargin: round2(baseline.medianMargin),
      p90Margin: round2(baseline.p90Margin),
      avgTeamPoints: round2(baseline.avgTeamPoints),
    },
    best: {
      scoring: best.scoring,
      meanMargin: round2(best.meanMargin),
      medianMargin: round2(best.medianMargin),
      p90Margin: round2(best.p90Margin),
      avgTeamPoints: round2(best.avgTeamPoints),
      marginImprovementPct: round2(marginImprovementPct),
    },
    bestBalanced: optimized.bestBalanced
      ? {
          scoring: optimized.bestBalanced.scoring,
          meanMargin: round2(optimized.bestBalanced.meanMargin),
          medianMargin: round2(optimized.bestBalanced.medianMargin),
          p90Margin: round2(optimized.bestBalanced.p90Margin),
          avgTeamPoints: round2(optimized.bestBalanced.avgTeamPoints),
          marginImprovementPct: round2(
            baseline.meanMargin > 0
              ? ((baseline.meanMargin - optimized.bestBalanced.meanMargin) /
                  baseline.meanMargin) *
                  100
              : 0,
          ),
        }
      : null,
    top5: optimized.top5.map((entry, index) => ({
      rank: index + 1,
      scoring: entry.scoring,
      meanMargin: round2(entry.meanMargin),
      medianMargin: round2(entry.medianMargin),
      p90Margin: round2(entry.p90Margin),
      avgTeamPoints: round2(entry.avgTeamPoints),
    })),
  };

  console.log(JSON.stringify(result, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
