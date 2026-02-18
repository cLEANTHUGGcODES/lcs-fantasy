type ErrorLike = {
  code?: unknown;
  status?: unknown;
  message?: unknown;
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
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const isAuthError = candidate.__isAuthError === true;

  if (code === "refresh_token_not_found") {
    return true;
  }

  if (code === "invalid_refresh_token") {
    return true;
  }

  return (
    isAuthError &&
    typeof candidate.status === "number" &&
    candidate.status === 400 &&
    message.toLowerCase().includes("refresh token")
  );
};

export const isSupabaseAuthCookieName = (name: string): boolean =>
  name.includes("supabase-auth-token") ||
  (name.startsWith("sb-") && name.includes("-auth-token"));
