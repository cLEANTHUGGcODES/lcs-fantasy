"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";

let browserClient: SupabaseClient | null = null;

export const getSupabaseBrowserClient = (): SupabaseClient => {
  if (browserClient) {
    return browserClient;
  }

  const { supabaseUrl, publicApiKey } = getSupabaseAuthEnv();
  browserClient = createBrowserClient(supabaseUrl, publicApiKey);
  return browserClient;
};
