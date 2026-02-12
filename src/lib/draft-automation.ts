import { getSupabaseServerClient } from "@/lib/supabase-server";

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

export const processDueDrafts = async ({
  draftId,
}: {
  draftId?: number;
} = {}): Promise<DraftProcessingResult> => {
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
