import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { GlobalChatMessage } from "@/types/chat";

const GLOBAL_CHAT_TABLE = "fantasy_global_chat_messages";
export const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;
const DEFAULT_GLOBAL_CHAT_LIMIT = 200;

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
  message: row.message,
  createdAt: row.created_at,
});

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

  return ((data ?? []) as GlobalChatRow[]).map(toGlobalChatMessage).reverse();
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
