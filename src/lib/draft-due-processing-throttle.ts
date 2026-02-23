const DEFAULT_THROTTLE_WINDOW_MS = 2500;
const THROTTLE_CACHE_MAX_ENTRIES = 512;
const THROTTLE_STALE_MULTIPLIER = 8;

const lastDueProcessingAtByKey = new Map<string, number>();

const pruneThrottleCache = (nowMs: number, windowMs: number): void => {
  if (lastDueProcessingAtByKey.size <= THROTTLE_CACHE_MAX_ENTRIES) {
    return;
  }

  const staleCutoffMs = nowMs - windowMs * THROTTLE_STALE_MULTIPLIER;
  for (const [key, value] of lastDueProcessingAtByKey) {
    if (value < staleCutoffMs) {
      lastDueProcessingAtByKey.delete(key);
    }
  }

  if (lastDueProcessingAtByKey.size <= THROTTLE_CACHE_MAX_ENTRIES) {
    return;
  }

  while (lastDueProcessingAtByKey.size > THROTTLE_CACHE_MAX_ENTRIES) {
    const oldestKey = lastDueProcessingAtByKey.keys().next().value;
    if (!oldestKey) {
      break;
    }
    lastDueProcessingAtByKey.delete(oldestKey);
  }
};

export const claimDueProcessingSlot = ({
  key,
  windowMs = DEFAULT_THROTTLE_WINDOW_MS,
}: {
  key: string;
  windowMs?: number;
}): boolean => {
  if (!key) {
    return true;
  }

  const nowMs = Date.now();
  const normalizedWindowMs = Math.max(0, Math.floor(windowMs));
  const lastProcessedAtMs = lastDueProcessingAtByKey.get(key);
  if (
    typeof lastProcessedAtMs === "number" &&
    normalizedWindowMs > 0 &&
    nowMs - lastProcessedAtMs < normalizedWindowMs
  ) {
    return false;
  }

  lastDueProcessingAtByKey.set(key, nowMs);
  pruneThrottleCache(nowMs, Math.max(1, normalizedWindowMs));
  return true;
};
