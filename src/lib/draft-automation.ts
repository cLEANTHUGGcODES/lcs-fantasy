import { withProjectedAutopickFantasyAverages } from "@/lib/draft-autopick-projections";
import { getLatestSnapshotFromSupabase } from "@/lib/supabase-match-store";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { FantasyScoring, ParsedGame } from "@/types/fantasy";

export interface DraftProcessingResult {
  startedDrafts: number;
  autoPicks: number;
  completedDrafts: number;
}

export interface DraftPickSubmissionResult {
  ok: boolean;
  error: string | null;
  code: string | null;
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasSnapshotGames = (
  payload: unknown,
): payload is { games: ParsedGame[]; scoring?: Partial<FantasyScoring> } =>
  isObject(payload) && Array.isArray(payload.games);

const resolveOptionalScoring = (payload: unknown): Partial<FantasyScoring> | null => {
  if (!isObject(payload) || !isObject(payload.scoring)) {
    return null;
  }
  return payload.scoring as Partial<FantasyScoring>;
};

const ensureAutopickProjectionValues = async (draftId: number): Promise<void> => {
  if (!Number.isFinite(draftId) || draftId < 1) {
    return;
  }

  const supabase = getSupabaseServerClient();
  const { data: draftRow, error: draftError } = await supabase
    .from("fantasy_drafts")
    .select("id,source_page")
    .eq("id", draftId)
    .maybeSingle<{ id: number; source_page: string }>();

  if (draftError || !draftRow?.source_page) {
    return;
  }

  const { data: teamPoolRows, error: teamPoolError } = await supabase
    .from("fantasy_draft_team_pool")
    .select("id,team_name,player_team,projected_avg_fantasy_points")
    .eq("draft_id", draftId)
    .order("id", { ascending: true });

  if (teamPoolError) {
    if (teamPoolError.message.includes("projected_avg_fantasy_points")) {
      return;
    }
    throw new Error(`Unable to load draft pool projections: ${teamPoolError.message}`);
  }

  const pool = (teamPoolRows ?? []) as Array<{
    id: number;
    team_name: string;
    player_team: string | null;
    projected_avg_fantasy_points: number | null;
  }>;
  if (pool.length === 0) {
    return;
  }

  const hasMissingProjection = pool.some(
    (entry) => typeof entry.projected_avg_fantasy_points !== "number",
  );
  if (!hasMissingProjection) {
    return;
  }

  let snapshot: { payload: unknown; storedAt: string };
  try {
    snapshot = await getLatestSnapshotFromSupabase(draftRow.source_page);
  } catch {
    return;
  }

  if (!hasSnapshotGames(snapshot.payload) || snapshot.payload.games.length === 0) {
    return;
  }

  const projectedPool = withProjectedAutopickFantasyAverages(
    pool.map((entry) => ({
      playerName: entry.team_name,
      playerTeam: entry.player_team,
    })),
    {
      games: snapshot.payload.games,
      scoring: resolveOptionalScoring(snapshot.payload),
    },
  );

  const projectionUpdates: Array<{ id: number; value: number }> = [];
  for (let index = 0; index < pool.length; index += 1) {
    const current = pool[index];
    const projected = projectedPool[index]?.projectedAvgFantasyPoints;
    if (typeof projected !== "number") {
      continue;
    }
    if (
      typeof current.projected_avg_fantasy_points === "number" &&
      Math.abs(current.projected_avg_fantasy_points - projected) < 0.01
    ) {
      continue;
    }
    projectionUpdates.push({
      id: current.id,
      value: projected,
    });
  }

  if (projectionUpdates.length === 0) {
    return;
  }

  for (const update of projectionUpdates) {
    const { error } = await supabase
      .from("fantasy_draft_team_pool")
      .update({
        projected_avg_fantasy_points: update.value,
      })
      .eq("id", update.id)
      .eq("draft_id", draftId);
    if (error) {
      throw new Error(`Unable to update draft pool projections: ${error.message}`);
    }
  }
};

const ensureAutopickProjectionsForActiveDrafts = async (): Promise<void> => {
  const supabase = getSupabaseServerClient();
  const { data: missingProjectionRows, error: missingProjectionError } = await supabase
    .from("fantasy_draft_team_pool")
    .select("draft_id")
    .is("projected_avg_fantasy_points", null)
    .limit(200);

  if (missingProjectionError) {
    if (missingProjectionError.message.includes("projected_avg_fantasy_points")) {
      return;
    }
    throw new Error(`Unable to scan drafts for missing autopick projections: ${missingProjectionError.message}`);
  }

  const draftIds = [...new Set(
    ((missingProjectionRows ?? []) as Array<{ draft_id: number }>)
      .map((entry) => entry.draft_id)
      .filter((entry) => Number.isFinite(entry) && entry > 0),
  )];
  if (draftIds.length === 0) {
    return;
  }

  const { data: activeDraftRows, error: activeDraftError } = await supabase
    .from("fantasy_drafts")
    .select("id")
    .in("id", draftIds)
    .in("status", ["scheduled", "live"]);

  if (activeDraftError) {
    throw new Error(`Unable to load active draft ids: ${activeDraftError.message}`);
  }

  const activeDraftIds = ((activeDraftRows ?? []) as Array<{ id: number }>)
    .map((entry) => entry.id)
    .filter((entry) => Number.isFinite(entry) && entry > 0);
  for (const activeDraftId of activeDraftIds) {
    await ensureAutopickProjectionValues(activeDraftId);
  }
};

export const processDueDrafts = async ({
  draftId,
}: {
  draftId?: number;
} = {}): Promise<DraftProcessingResult> => {
  if (typeof draftId === "number") {
    try {
      await ensureAutopickProjectionValues(draftId);
    } catch (error) {
      console.warn(
        "[draft] unable to refresh autopick projections:",
        error instanceof Error ? error.message : error,
      );
    }
  } else {
    try {
      await ensureAutopickProjectionsForActiveDrafts();
    } catch (error) {
      console.warn(
        "[draft] unable to refresh active draft autopick projections:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("fantasy_process_due_drafts", {
    p_draft_id: draftId ?? null,
  });

  if (error) {
    throw new Error(`Unable to process draft automation: ${error.message}`);
  }

  const payload = asObject(data);
  return {
    startedDrafts: asNumber(payload?.started_drafts),
    autoPicks: asNumber(payload?.auto_picks),
    completedDrafts: asNumber(payload?.completed_drafts),
  };
};

export const submitDraftPickAtomic = async ({
  draftId,
  userId,
  userLabel,
  playerName,
}: {
  draftId: number;
  userId: string;
  userLabel: string;
  playerName: string;
}): Promise<DraftPickSubmissionResult> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("fantasy_submit_draft_pick", {
    p_draft_id: draftId,
    p_user_id: userId,
    p_user_label: userLabel,
    p_team_name: playerName,
  });

  if (error) {
    throw new Error(`Unable to record draft pick: ${error.message}`);
  }

  const payload = asObject(data);
  return {
    ok: payload?.ok === true,
    error: asStringOrNull(payload?.error),
    code: asStringOrNull(payload?.code),
  };
};
