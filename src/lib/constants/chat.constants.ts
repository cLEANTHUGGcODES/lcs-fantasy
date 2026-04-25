import { MAX_CHAT_IMAGE_URL_LENGTH } from "@/lib/chat-image";

export const GLOBAL_CHAT_TABLE = "fantasy_global_chat_messages";
export const GLOBAL_CHAT_REACTIONS_TABLE = "fantasy_global_chat_reactions";
export const CHAT_OBSERVABILITY_TABLE = "fantasy_chat_observability_events";
export const CHAT_POST_RPC_NAME = "fantasy_chat_post_message";
export const CHAT_CLEANUP_RPC_NAME = "fantasy_cleanup_chat_data";
export const CHAT_OBSERVABILITY_SUMMARY_RPC_NAME =
  "fantasy_chat_observability_summary";
export const DEFAULT_GLOBAL_CHAT_LIMIT = 120;
export const MAX_GLOBAL_CHAT_LIMIT = 200;
export const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;
export const MAX_GLOBAL_CHAT_IMAGE_URL_LENGTH = MAX_CHAT_IMAGE_URL_LENGTH;
export const MAX_GLOBAL_CHAT_REACTION_EMOJI_LENGTH = 16;

export const GLOBAL_CHAT_SELECT_COLUMNS = [
  "id",
  "user_id",
  "sender_label",
  "sender_avatar_url",
  "sender_avatar_border_color",
  "message",
  "image_url",
  "created_at",
].join(",");
