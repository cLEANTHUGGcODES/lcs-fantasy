import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";

export const requireAuthUser = async (
  providedSupabase?: SupabaseClient,
): Promise<User> => {
  const supabase = providedSupabase ?? await getSupabaseAuthServerClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }
  return user;
};
