import { getSupabaseServerClient } from "@/lib/supabase-server";

const ADMIN_TABLE = "fantasy_app_admin";
const DRAFTS_TABLE = "fantasy_drafts";
const ADMIN_ROW_ID = 1;

type AdminRow = {
  id: number;
  admin_user_id: string;
};

type DraftCreatorRow = {
  created_by_user_id: string;
};

const loadAdminRow = async (): Promise<AdminRow | null> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(ADMIN_TABLE)
    .select("id,admin_user_id")
    .eq("id", ADMIN_ROW_ID)
    .maybeSingle<AdminRow>();

  if (error) {
    throw new Error(`Unable to load admin configuration: ${error.message}`);
  }

  return data ?? null;
};

export const getGlobalAdminUserId = async (): Promise<string | null> => {
  const row = await loadAdminRow();
  return row?.admin_user_id ?? null;
};

const resolveSeedUserId = async (fallbackUserId: string): Promise<string> => {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(DRAFTS_TABLE)
    .select("created_by_user_id")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to resolve admin seed user: ${error.message}`);
  }

  const uniqueCreators = new Set(
    ((data ?? []) as DraftCreatorRow[])
      .map((entry) => entry.created_by_user_id)
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
  );

  if (uniqueCreators.size === 1) {
    const [onlyCreator] = uniqueCreators;
    return onlyCreator;
  }

  return fallbackUserId;
};

export const ensureGlobalAdminUserId = async (seedUserId: string): Promise<string> => {
  const existing = await loadAdminRow();
  if (existing?.admin_user_id) {
    return existing.admin_user_id;
  }

  const resolvedSeedUserId = await resolveSeedUserId(seedUserId);

  const supabase = getSupabaseServerClient();
  const { error: insertError } = await supabase
    .from(ADMIN_TABLE)
    .insert({
      id: ADMIN_ROW_ID,
      admin_user_id: resolvedSeedUserId,
      updated_at: new Date().toISOString(),
    });

  if (insertError && insertError.code !== "23505") {
    throw new Error(`Unable to initialize admin configuration: ${insertError.message}`);
  }

  const finalized = await loadAdminRow();
  if (!finalized?.admin_user_id) {
    throw new Error("Unable to resolve admin configuration.");
  }

  return finalized.admin_user_id;
};

export const isGlobalAdminUser = async ({
  userId,
  seedIfUnset = false,
}: {
  userId: string;
  seedIfUnset?: boolean;
}): Promise<boolean> => {
  const adminUserId = seedIfUnset
    ? await ensureGlobalAdminUserId(userId)
    : await getGlobalAdminUserId();
  return adminUserId === userId;
};
