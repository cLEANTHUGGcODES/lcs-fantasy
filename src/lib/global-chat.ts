import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getUserAvatarBorderColor, getUserAvatarUrl } from "@/lib/user-profile";
import type { GlobalChatMessage } from "@/types/chat";

const GLOBAL_CHAT_TABLE = "fantasy_global_chat_messages";
const CHAT_OBSERVABILITY_TABLE = "fantasy_chat_observability_events";
const CHAT_POST_RPC_NAME = "fantasy_chat_post_message";
const CHAT_CLEANUP_RPC_NAME = "fantasy_cleanup_chat_data";
const CHAT_OBSERVABILITY_SUMMARY_RPC_NAME = "fantasy_chat_observability_summary";
const DEFAULT_GLOBAL_CHAT_LIMIT = 120;
const MAX_GLOBAL_CHAT_LIMIT = 200;
export const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;
const AVATAR_CACHE_TTL_MS = 5 * 60 * 1000;

const GLOBAL_CHAT_SELECT_COLUMNS = [
  "id",
  "user_id",
  "sender_label",
  "sender_avatar_url",
  "sender_avatar_border_color",
  "message",
  "created_at",
].join(",");

type GlobalChatRow = {
  id: number;
  user_id: string;
  sender_label: string;
  sender_avatar_url: string | null;
  sender_avatar_border_color: string | null;
  message: string;
  created_at: string;
};

type CachedAvatarProfile = {
  avatarUrl: string | null;
  avatarBorderColor: string | null;
  expiresAt: number;
};

const avatarProfileByUserIdCache = new Map<string, CachedAvatarProfile>();

const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.parseInt(`${value ?? ""}`, 10) || 0;

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const asBoolean = (value: unknown): boolean => value === true;

const clampLimit = (value: number | undefined): number => {
  const numeric = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_GLOBAL_CHAT_LIMIT;
  return Math.max(1, Math.min(numeric, MAX_GLOBAL_CHAT_LIMIT));
};

const normalizePositiveId = (value: number | undefined): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value as number));
};

const toGlobalChatMessage = (row: GlobalChatRow): GlobalChatMessage => ({
  id: row.id,
  userId: row.user_id,
  senderLabel: row.sender_label,
  senderAvatarUrl: row.sender_avatar_url,
  senderAvatarBorderColor: row.sender_avatar_border_color,
  message: row.message,
  createdAt: row.created_at,
});

const resolveAvatarProfilesForUsers = async (
  userIds: string[],
): Promise<Map<string, { avatarUrl: string | null; avatarBorderColor: string | null }>> => {
  const now = Date.now();
  const resolved = new Map<string, { avatarUrl: string | null; avatarBorderColor: string | null }>();
  const missingUserIds: string[] = [];

  for (const userId of userIds) {
    const cached = avatarProfileByUserIdCache.get(userId);
    if (cached && cached.expiresAt > now) {
      resolved.set(userId, {
        avatarUrl: cached.avatarUrl,
        avatarBorderColor: cached.avatarBorderColor,
      });
      continue;
    }
    missingUserIds.push(userId);
  }

  if (missingUserIds.length === 0) {
    return resolved;
  }

  const supabase = getSupabaseServerClient();
  const { supabaseUrl } = getSupabaseAuthEnv();

  await Promise.all(
    missingUserIds.map(async (userId) => {
      let avatarUrl: string | null = null;
      let avatarBorderColor: string | null = null;
      try {
        const { data, error } = await supabase.auth.admin.getUserById(userId);
        if (!error && data?.user) {
          avatarUrl = getUserAvatarUrl({
            user: data.user,
            supabaseUrl,
          });
          avatarBorderColor = getUserAvatarBorderColor(data.user);
        }
      } catch {
        avatarUrl = null;
        avatarBorderColor = null;
      }

      avatarProfileByUserIdCache.set(userId, {
        avatarUrl,
        avatarBorderColor,
        expiresAt: now + AVATAR_CACHE_TTL_MS,
      });
      resolved.set(userId, { avatarUrl, avatarBorderColor });
    }),
  );

  return resolved;
};

const hydrateMissingAvatarFields = async (
  messages: GlobalChatMessage[],
): Promise<GlobalChatMessage[]> => {
  const missingUserIds = [
    ...new Set(
      messages
        .filter((entry) => !entry.senderAvatarUrl || !entry.senderAvatarBorderColor)
        .map((entry) => entry.userId),
    ),
  ];
  if (missingUserIds.length === 0) {
    return messages;
  }

  const avatarProfiles = await resolveAvatarProfilesForUsers(missingUserIds);
  if (avatarProfiles.size === 0) {
    return messages;
  }

  return messages.map((entry) => {
    const profile = avatarProfiles.get(entry.userId);
    if (!profile) {
      return entry;
    }
    return {
      ...entry,
      senderAvatarUrl: entry.senderAvatarUrl ?? profile.avatarUrl,
      senderAvatarBorderColor: entry.senderAvatarBorderColor ?? profile.avatarBorderColor,
    };
  });
};

const toRpcGlobalChatMessage = (value: unknown): GlobalChatMessage | null => {
  const payload = asObject(value);
  if (!payload) {
    return null;
  }

  const id = asNumber(payload.id);
  const userId = asStringOrNull(payload.user_id);
  const senderLabel = asStringOrNull(payload.sender_label);
  const message = asStringOrNull(payload.message);
  const createdAt = asStringOrNull(payload.created_at);
  if (!id || !userId || !senderLabel || !message || !createdAt) {
    return null;
  }

  return {
    id,
    userId,
    senderLabel,
    senderAvatarUrl: asStringOrNull(payload.sender_avatar_url),
    senderAvatarBorderColor: asStringOrNull(payload.sender_avatar_border_color),
    message,
    createdAt,
  };
};

export class GlobalChatError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "GlobalChatError";
    this.code = code;
  }
}

export type ListGlobalChatMessagesResult = {
  messages: GlobalChatMessage[];
  hasMore: boolean;
  nextBeforeId: number | null;
};

export type ChatObservabilityMetricName =
  | "fetch_latency_ms"
  | "send_latency_ms"
  | "realtime_disconnect"
  | "fallback_sync"
  | "duplicate_drop";

export type ChatObservabilityEventInput = {
  metricName: ChatObservabilityMetricName;
  metricValue: number;
  metadata?: Record<string, unknown>;
};

export const normalizeGlobalChatMessage = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

export const listGlobalChatMessages = async ({
  supabase,
  limit = DEFAULT_GLOBAL_CHAT_LIMIT,
  afterId,
  beforeId,
}: {
  supabase: SupabaseClient;
  limit?: number;
  afterId?: number;
  beforeId?: number;
}): Promise<ListGlobalChatMessagesResult> => {
  const safeLimit = clampLimit(limit);
  const normalizedAfterId = normalizePositiveId(afterId);
  const normalizedBeforeId = normalizePositiveId(beforeId);
  const pageSize = safeLimit + 1;

  let query = supabase.from(GLOBAL_CHAT_TABLE).select(GLOBAL_CHAT_SELECT_COLUMNS);

  if (normalizedAfterId > 0) {
    query = query
      .gt("id", normalizedAfterId)
      .order("id", { ascending: true })
      .limit(pageSize);
  } else if (normalizedBeforeId > 0) {
    query = query
      .lt("id", normalizedBeforeId)
      .order("id", { ascending: false })
      .limit(pageSize);
  } else {
    query = query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageSize);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Unable to load global chat messages: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as GlobalChatRow[];
  const hasMore = rows.length > safeLimit;
  const limitedRows = hasMore ? rows.slice(0, safeLimit) : rows;

  if (normalizedAfterId > 0) {
    const messages = limitedRows.map(toGlobalChatMessage);
    const hydratedMessages = await hydrateMissingAvatarFields(messages);
    return {
      messages: hydratedMessages,
      hasMore,
      nextBeforeId: null,
    };
  }

  const chronologicalRows = [...limitedRows].reverse();
  const messages = chronologicalRows.map(toGlobalChatMessage);
  const hydratedMessages = await hydrateMissingAvatarFields(messages);
  return {
    messages: hydratedMessages,
    hasMore,
    nextBeforeId: hydratedMessages[0]?.id ?? null,
  };
};

export const submitGlobalChatMessage = async ({
  supabase,
  senderLabel,
  senderAvatarUrl,
  senderAvatarBorderColor,
  message,
  idempotencyKey,
}: {
  supabase: SupabaseClient;
  senderLabel: string;
  senderAvatarUrl: string | null;
  senderAvatarBorderColor: string | null;
  message: string;
  idempotencyKey?: string | null;
}): Promise<{ message: GlobalChatMessage; duplicate: boolean }> => {
  const normalizedMessage = normalizeGlobalChatMessage(message);
  const normalizedSenderLabel = senderLabel.trim();
  const normalizedIdempotencyKey = idempotencyKey?.trim() || null;

  if (!normalizedSenderLabel) {
    throw new GlobalChatError("Chat sender label is required.", "INVALID_SENDER_LABEL");
  }
  if (!normalizedMessage) {
    throw new GlobalChatError("Message cannot be empty.", "EMPTY_MESSAGE");
  }
  if (normalizedMessage.length > MAX_GLOBAL_CHAT_MESSAGE_LENGTH) {
    throw new GlobalChatError(
      `Message must be ${MAX_GLOBAL_CHAT_MESSAGE_LENGTH} characters or fewer.`,
      "MESSAGE_TOO_LONG",
    );
  }

  const { data, error } = await supabase.rpc(CHAT_POST_RPC_NAME, {
    p_sender_label: normalizedSenderLabel,
    p_message: normalizedMessage,
    p_sender_avatar_url: senderAvatarUrl,
    p_sender_avatar_border_color: senderAvatarBorderColor,
    p_idempotency_key: normalizedIdempotencyKey,
  });

  if (error) {
    throw new Error(`Unable to send chat message: ${error.message}`);
  }

  const payload = asObject(data);
  const isOk = payload?.ok === true;
  if (!isOk) {
    const errorMessage = asStringOrNull(payload?.error) ?? "Unable to send chat message.";
    const code = asStringOrNull(payload?.code);
    throw new GlobalChatError(errorMessage, code);
  }

  const parsedMessage = toRpcGlobalChatMessage(payload?.message);
  if (!parsedMessage) {
    throw new Error("Unable to parse chat message response.");
  }

  return {
    message: parsedMessage,
    duplicate: asBoolean(payload?.duplicate),
  };
};

export const recordChatObservabilityEvents = async ({
  supabase,
  userId,
  source,
  events,
}: {
  supabase: SupabaseClient;
  userId: string;
  source: "server" | "client";
  events: ChatObservabilityEventInput[];
}): Promise<void> => {
  const rows = events
    .map((entry) => {
      const normalizedValue = Math.max(0, Math.floor(entry.metricValue));
      if (!normalizedValue) {
        return null;
      }
      return {
        user_id: userId,
        source,
        metric_name: entry.metricName,
        metric_value: normalizedValue,
        metadata: entry.metadata ?? {},
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase.from(CHAT_OBSERVABILITY_TABLE).insert(rows);
  if (error) {
    throw new Error(`Unable to record chat observability event: ${error.message}`);
  }
};

export const cleanupGlobalChatData = async ({
  retainDays = 45,
  keepRecent = 5000,
  metricRetainDays = 14,
}: {
  retainDays?: number;
  keepRecent?: number;
  metricRetainDays?: number;
} = {}): Promise<{
  deletedMessages: number;
  deletedObservabilityEvents: number;
}> => {
  const supabase = getSupabaseServerClient();
  const safeRetainDays = Math.max(1, Math.floor(retainDays));
  const safeKeepRecent = Math.max(0, Math.floor(keepRecent));
  const safeMetricRetainDays = Math.max(1, Math.floor(metricRetainDays));

  const { data, error } = await supabase.rpc(CHAT_CLEANUP_RPC_NAME, {
    p_retain_days: safeRetainDays,
    p_keep_recent: safeKeepRecent,
    p_metric_retain_days: safeMetricRetainDays,
  });

  if (error) {
    throw new Error(`Unable to clean up chat data: ${error.message}`);
  }

  const payload = asObject(data);
  return {
    deletedMessages: asNumber(payload?.deleted_messages),
    deletedObservabilityEvents: asNumber(payload?.deleted_observability_events),
  };
};

export const getChatObservabilitySummary = async ({
  windowMinutes = 1440,
}: {
  windowMinutes?: number;
} = {}): Promise<Record<string, unknown>> => {
  const supabase = getSupabaseServerClient();
  const safeWindowMinutes = Math.max(1, Math.floor(windowMinutes));

  const { data, error } = await supabase.rpc(CHAT_OBSERVABILITY_SUMMARY_RPC_NAME, {
    p_window_minutes: safeWindowMinutes,
  });
  if (error) {
    throw new Error(`Unable to load chat observability summary: ${error.message}`);
  }

  return asObject(data) ?? {};
};
