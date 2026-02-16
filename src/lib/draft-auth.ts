import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getSupabaseAuthServerClient } from "@/lib/supabase-auth-server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const readBearerToken = (authorization: string | null): string | null => {
  if (!authorization) {
    return null;
  }
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "bearer") {
    return null;
  }
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
};

export const requireAuthUser = async (
  providedSupabase?: SupabaseClient,
  request?: Request,
): Promise<User> => {
  const bearerToken = readBearerToken(request?.headers.get("authorization") ?? null);
  if (bearerToken) {
    const serviceSupabase = getSupabaseServerClient();
    const {
      data: { user },
      error,
    } = await serviceSupabase.auth.getUser(bearerToken);
    if (error || !user) {
      throw new Error("UNAUTHORIZED");
    }
    return user;
  }

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
