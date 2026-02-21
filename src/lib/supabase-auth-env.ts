const readPublicApiKey = (): string => {
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (publishableKey) {
    return publishableKey;
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey) {
    return anonKey;
  }

  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).",
  );
};

const readSupabaseUrl = (): string => {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

  if (supabaseUrl) {
    return supabaseUrl;
  }

  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL on server).",
  );
};

let cachedSupabaseAuthEnv:
  | {
      supabaseUrl: string;
      publicApiKey: string;
    }
  | null = null;
let cachedSupabaseAuthEnvKey: string | null = null;

export const getSupabaseAuthEnv = (): {
  supabaseUrl: string;
  publicApiKey: string;
} => {
  const supabaseUrl = readSupabaseUrl();
  const publicApiKey = readPublicApiKey();
  const envKey = `${supabaseUrl}::${publicApiKey}`;

  if (cachedSupabaseAuthEnv && cachedSupabaseAuthEnvKey === envKey) {
    return cachedSupabaseAuthEnv;
  }

  cachedSupabaseAuthEnv = {
    supabaseUrl,
    publicApiKey,
  };
  cachedSupabaseAuthEnvKey = envKey;
  return cachedSupabaseAuthEnv;
};
