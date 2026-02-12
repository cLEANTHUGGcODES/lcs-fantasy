import type { FantasySnapshot } from "@/types/fantasy";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const DEFAULT_TABLE = "fantasy_match_snapshots";

const getTableName = (): string =>
  process.env.SUPABASE_MATCH_SNAPSHOTS_TABLE ?? DEFAULT_TABLE;

type SnapshotRow = {
  source_page: string;
  games: unknown;
  stored_at: string;
};

const fetchLatestSnapshotRow = async (
  sourcePage: string,
): Promise<SnapshotRow | null> => {
  const supabase = getSupabaseServerClient();
  const table = getTableName();

  const { data, error } = await supabase
    .from(table)
    .select("source_page,games,stored_at")
    .eq("source_page", sourcePage)
    .order("stored_at", { ascending: false })
    .limit(1)
    .maybeSingle<SnapshotRow>();

  if (error) {
    throw new Error(`Failed loading snapshot from Supabase: ${error.message}`);
  }

  return data ?? null;
};

export const tryGetLatestSnapshotFromSupabase = async (
  sourcePage: string,
): Promise<{ payload: unknown; storedAt: string } | null> => {
  const data = await fetchLatestSnapshotRow(sourcePage);
  if (!data) {
    return null;
  }

  return {
    payload: typeof data.games === "string" ? JSON.parse(data.games) : data.games,
    storedAt: data.stored_at,
  };
};

export const getLatestSnapshotFromSupabase = async (
  sourcePage: string,
): Promise<{ payload: unknown; storedAt: string }> => {
  const data = await tryGetLatestSnapshotFromSupabase(sourcePage);
  if (!data) {
    throw new Error(
      `No snapshot found in Supabase for source page "${sourcePage}". Run sync first.`,
    );
  }
  return data;
};

export const storeSnapshotInSupabase = async ({
  snapshot,
  createdBy,
}: {
  snapshot: Omit<FantasySnapshot, "generatedAt">;
  createdBy?: string;
}): Promise<{ sourcePage: string; storedAt: string }> => {
  const supabase = getSupabaseServerClient();
  const table = getTableName();
  const storedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from(table)
    .insert({
      source_page: snapshot.sourcePage,
      games: {
        ...snapshot,
        generatedAt: storedAt,
      },
      stored_at: storedAt,
      created_by: createdBy ?? "manual-sync",
    })
    .select("source_page,stored_at")
    .single<{ source_page: string; stored_at: string }>();

  if (error) {
    throw new Error(`Failed writing snapshot to Supabase: ${error.message}`);
  }

  return {
    sourcePage: data.source_page,
    storedAt: data.stored_at,
  };
};
