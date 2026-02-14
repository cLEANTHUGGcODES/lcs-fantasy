import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getUserAvatarBorderColor, getUserAvatarUrl } from "@/lib/user-profile";
import type { GlobalChatMessage } from "@/types/chat";

const GLOBAL_CHAT_TABLE = "fantasy_global_chat_messages";
export const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;
const DEFAULT_GLOBAL_CHAT_LIMIT = 200;
const AVATAR_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedAvatarProfile = {
  avatarUrl: string | null;
  avatarBorderColor: string | null;
  expiresAt: number;
};

const avatarProfileByUserIdCache = new Map<string, CachedAvatarProfile>();

type GlobalChatRow = {
  id: number;
  user_id: string;
  sender_label: string;
  message: string;
  created_at: string;
};

const toGlobalChatMessage = (row: GlobalChatRow): GlobalChatMessage => ({
  id: row.id,
  userId: row.user_id,
  senderLabel: row.sender_label,
  senderAvatarUrl: null,
  senderAvatarBorderColor: null,
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

export const normalizeGlobalChatMessage = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

export const listGlobalChatMessages = async ({
  limit = DEFAULT_GLOBAL_CHAT_LIMIT,
}: {
  limit?: number;
} = {}): Promise<GlobalChatMessage[]> => {
  const safeLimit = Math.max(1, Math.min(limit, DEFAULT_GLOBAL_CHAT_LIMIT));
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(GLOBAL_CHAT_TABLE)
    .select("id,user_id,sender_label,message,created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Unable to load global chat messages: ${error.message}`);
  }

  const baseMessages = ((data ?? []) as GlobalChatRow[]).map(toGlobalChatMessage).reverse();
  const uniqueUserIds = [...new Set(baseMessages.map((entry) => entry.userId))];
  const avatarProfilesByUserId = await resolveAvatarProfilesForUsers(uniqueUserIds);

  return baseMessages.map((entry) => ({
    ...entry,
    senderAvatarUrl: avatarProfilesByUserId.get(entry.userId)?.avatarUrl ?? null,
    senderAvatarBorderColor:
      avatarProfilesByUserId.get(entry.userId)?.avatarBorderColor ?? null,
  }));
};

export const createGlobalChatMessage = async ({
  userId,
  senderLabel,
  message,
}: {
  userId: string;
  senderLabel: string;
  message: string;
}): Promise<GlobalChatMessage> => {
  const normalizedMessage = normalizeGlobalChatMessage(message);
  const normalizedSenderLabel = senderLabel.trim();

  if (!normalizedSenderLabel) {
    throw new Error("Chat sender label is required.");
  }
  if (!normalizedMessage) {
    throw new Error("Message cannot be empty.");
  }
  if (normalizedMessage.length > MAX_GLOBAL_CHAT_MESSAGE_LENGTH) {
    throw new Error(
      `Message must be ${MAX_GLOBAL_CHAT_MESSAGE_LENGTH} characters or fewer.`,
    );
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from(GLOBAL_CHAT_TABLE)
    .insert({
      user_id: userId,
      sender_label: normalizedSenderLabel,
      message: normalizedMessage,
    })
    .select("id,user_id,sender_label,message,created_at")
    .single<GlobalChatRow>();

  if (error) {
    throw new Error(`Unable to send chat message: ${error.message}`);
  }

  return toGlobalChatMessage(data);
};
