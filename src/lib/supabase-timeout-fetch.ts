const readTimeoutMs = (): number => {
  const raw = process.env.SUPABASE_REQUEST_TIMEOUT_MS;
  if (!raw) {
    return 2500;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 2500;
  }

  return parsed;
};

export const SUPABASE_REQUEST_TIMEOUT_MS = readTimeoutMs();

export const supabaseFetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const upstreamSignal = init?.signal;

  if (upstreamSignal?.aborted) {
    controller.abort();
  } else if (upstreamSignal) {
    upstreamSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const timeout = setTimeout(() => {
    controller.abort();
  }, SUPABASE_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};
