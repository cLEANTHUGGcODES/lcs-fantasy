import {
  DEFAULT_GLOBAL_CHAT_LIMIT,
  MAX_GLOBAL_CHAT_LIMIT,
} from "@/lib/constants/chat.constants";

export const clampLimit = (value: number | undefined): number => {
  const numeric = Number.isFinite(value)
    ? Math.floor(value as number)
    : DEFAULT_GLOBAL_CHAT_LIMIT;
  return Math.max(1, Math.min(numeric, MAX_GLOBAL_CHAT_LIMIT));
};

export const normalizePositiveId = (value: number | undefined): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value as number));
};

export const normalizeReactionEmoji = (value: string): string => value.trim();
