import { createClient } from "@supabase/supabase-js";

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const createSupabaseServerClient = (
  supabaseUrl: string,
  serviceRoleKey: string,
) =>
  createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

type SupabaseServerClient = ReturnType<typeof createSupabaseServerClient>;

let cachedSupabaseServerClient: SupabaseServerClient | null = null;
let cachedSupabaseServerClientKey: string | null = null;

export const getSupabaseServerClient = () => {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const clientKey = `${supabaseUrl}::${serviceRoleKey}`;

  if (
    cachedSupabaseServerClient &&
    cachedSupabaseServerClientKey === clientKey
  ) {
    return cachedSupabaseServerClient;
  }

  cachedSupabaseServerClient = createSupabaseServerClient(
    supabaseUrl,
    serviceRoleKey,
  );
  cachedSupabaseServerClientKey = clientKey;
  return cachedSupabaseServerClient;
};
