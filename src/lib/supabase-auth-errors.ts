type ErrorLike = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
  __isAuthError?: unknown;
};

const asErrorLike = (value: unknown): ErrorLike | null => {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as ErrorLike;
};

export const isRecoverableSupabaseAuthError = (error: unknown): boolean => {
  const candidate = asErrorLike(error);
  if (!candidate) {
    return false;
  }

  const code = typeof candidate.code === "string" ? candidate.code : "";
  const name = typeof candidate.name === "string" ? candidate.name : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const normalizedName = name.toLowerCase();
  const normalizedMessage = message.toLowerCase();
  const isAuthError = candidate.__isAuthError === true;

  if (code === "refresh_token_not_found") {
    return true;
  }

  if (code === "invalid_refresh_token") {
    return true;
  }

  if (code === "auth_session_missing" || code === "session_not_found") {
    return true;
  }

  if (normalizedName === "authsessionmissingerror") {
    return true;
  }

  if (
    normalizedMessage.includes("auth session missing") ||
    normalizedMessage.includes("session not found")
  ) {
    return true;
  }

  if (
    isAuthError &&
    typeof candidate.status === "number" &&
    candidate.status === 400 &&
    normalizedMessage.includes("auth session missing")
  ) {
    return true;
  }

  return (
    isAuthError &&
    typeof candidate.status === "number" &&
    candidate.status === 400 &&
    normalizedMessage.includes("refresh token")
  );
};

export const isSupabaseAuthCookieName = (name: string): boolean =>
  name.includes("supabase-auth-token") ||
  (name.startsWith("sb-") && name.includes("-auth-token"));
