import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";

export const getSupabaseAuthServerClient = async () => {
  const cookieStore = await cookies();
  const { supabaseUrl, publicApiKey } = getSupabaseAuthEnv();

  return createServerClient(supabaseUrl, publicApiKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Some server execution contexts (e.g. Server Components) are read-only.
        }
      },
    },
  });
};
