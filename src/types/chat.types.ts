import { GlobalChatMessage } from "@/interfaces/chat.interfaces";

// TODO: add js-doc comments to all of these types
export type GlobalChatRow = {
  id: number;
  user_id: string;
  sender_label: string;
  sender_avatar_url: string | null;
  sender_avatar_border_color: string | null;
  message: string;
  image_url: string | null;
  created_at: string;
};

export type GlobalChatReactionRow = {
  id: number;
  message_id: number;
  user_id: string;
  reactor_label: string;
  emoji: string;
  created_at: string;
};

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
