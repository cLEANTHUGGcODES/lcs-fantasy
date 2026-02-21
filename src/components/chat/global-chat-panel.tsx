"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Modal, ModalBody, ModalContent } from "@heroui/modal";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Spinner } from "@heroui/spinner";
import { Tooltip } from "@heroui/tooltip";
import { ChevronDown, ChevronLeft, Copy, ExternalLink, ImagePlus, MessageCircle, MoreHorizontal, Reply, Send, X } from "lucide-react";
import Image from "next/image";
import { ChangeEvent, ClipboardEvent, Profiler, ProfilerOnRenderCallback, ReactNode, memo, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  MAX_CHAT_IMAGE_BYTES,
  isSupportedChatImageMimeType,
  normalizeChatImageUrl,
} from "@/lib/chat-image";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { GlobalChatMessage, GlobalChatReaction } from "@/types/chat";

type GlobalChatResponse = {
  messages?: GlobalChatMessage[];
  message?: GlobalChatMessage;
  hasMore?: boolean;
  nextBeforeId?: number | null;
  duplicate?: boolean;
  error?: string;
};

type GlobalChatUploadResponse = {
  imageUrl?: string;
  path?: string;
  error?: string;
};

type GlobalChatToggleReactionResponse = {
  messageId?: number;
  reactions?: GlobalChatReaction[];
  error?: string;
  code?: string;
};

type AttachedChatImage = {
  imageUrl: string;
  path: string;
  fileName: string;
};

type ChatReplyContext = {
  messageId: number;
  senderLabel: string;
  snippet: string;
};

type ParsedChatMessage = {
  body: string;
  replyContext: ChatReplyContext | null;
};

type ChatLightboxImage = {
  imageUrl: string;
  senderLabel: string;
  createdAt: string;
};

type ChatMessageGroup = {
  groupKey: string;
  renderSignature: string;
  userId: string;
  senderLabel: string;
  senderAvatarUrl: string | null;
  senderAvatarBorderColor: string | null;
  dayKey: string;
  dayLabel: string;
  isCurrentUser: boolean;
  messages: GlobalChatMessage[];
  messageIds: number[];
  estimatedHeight: number;
};

type MessageDayMetaCacheEntry = {
  createdAt: string;
  todayKey: string;
  dayKey: string;
  dayLabel: string;
};

type MessageRenderSignatureCacheEntry = {
  createdAt: string;
  message: string;
  imageUrl: string | null;
  reactionsRef: GlobalChatReaction[];
  signature: string;
};

type ChatRenderProfileStats = {
  mounts: number;
  updates: number;
  commits: number;
  commitDurationTotalMs: number;
  commitDurationMaxMs: number;
  commitsOverBudget: number;
  actionBarTransitions: number;
  actionBarTransitionTotalMs: number;
  actionBarTransitionMaxMs: number;
  actionBarTransitionsOverBudget: number;
};

type ChatRenderBlock =
  | {
      type: "older";
      key: "older-messages";
    }
  | {
      type: "empty";
      key: "empty-chat";
    }
  | {
      type: "group";
      key: string;
      group: ChatMessageGroup;
      previousGroupDayKey: string | null;
      estimatedHeight: number;
    };

type ChatRenderBlockLayout = ChatRenderBlock & {
  top: number;
  height: number;
  bottom: number;
};

type ChatStoreState = {
  messages: GlobalChatMessage[];
  hasOlderMessages: boolean;
  oldestCursorId: number | null;
};

type ChatStoreAction =
  | {
      type: "replace";
      messages: GlobalChatMessage[];
      hasOlderMessages: boolean;
      oldestCursorId: number | null;
    }
  | {
      type: "updateMessages";
      updater: (currentMessages: GlobalChatMessage[]) => GlobalChatMessage[];
    }
  | {
      type: "setPaging";
      hasOlderMessages: boolean;
      oldestCursorId: number | null;
    };

const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;
const CHAT_INITIAL_FETCH_LIMIT = 120;
const CHAT_INCREMENTAL_FETCH_LIMIT = 60;
const CHAT_PAGE_FETCH_LIMIT = 80;
const CHAT_FALLBACK_POLL_INTERVAL_MS = 10000;
const CHAT_WAKE_SYNC_DEBOUNCE_MS = 400;
const CHAT_METRICS_FLUSH_INTERVAL_MS = 60000;
const CHAT_AUTO_SCROLL_THRESHOLD_PX = 96;
const CHAT_COMPOSER_MIN_HEIGHT_PX = 36;
const CHAT_COMPOSER_MAX_HEIGHT_PX = 96;
const CHAT_UPLOAD_IMAGE_MAX_DIMENSION_PX = 1600;
const CHAT_UPLOAD_IMAGE_SCALE_STEPS = [1, 0.9, 0.8, 0.7, 0.6, 0.5] as const;
const CHAT_UPLOAD_IMAGE_QUALITY_STEPS = [0.92, 0.84, 0.76, 0.68] as const;
const CHAT_COMPOSER_FIELD_ID = "x_91f3";
const CHAT_COMPOSER_FIELD_NAME = "x_91f3";
const CHAT_IMAGE_ACCEPT_VALUE = "image/jpeg,image/png,image/webp";
const CHAT_EXTERNAL_IMAGE_PATH = "__external__";
const IMAGE_URL_EXTENSION_PATTERN = /\.(avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const CHAT_REPLY_TOKEN_PATTERN = /^\[rq:(\d+):([^:\]]*):([^:\]]*)\]\s*/;
const CHAT_REPLY_SENDER_MAX_LENGTH = 36;
const CHAT_REPLY_SNIPPET_MAX_LENGTH = 90;
const CHAT_QUICK_REACTIONS = ["😀", "🔥", "👏", "🙌"] as const;
const MAX_GLOBAL_CHAT_FETCH_LIMIT = 200;
const CHAT_ACTION_BAR_HIDE_DELAY_MS = 140;
const CHAT_INCREMENTAL_TRUE_UP_DEBOUNCE_MS = 1200;
const CHAT_VIRTUALIZATION_OVERSCAN_PX = 520;
const CHAT_VIRTUALIZATION_MIN_BLOCK_COUNT = 18;
const CHAT_ENABLE_VIRTUALIZATION = process.env.NEXT_PUBLIC_CHAT_VIRTUALIZATION === "1";
const CHAT_PROFILE_ENABLED = process.env.NEXT_PUBLIC_CHAT_PROFILE === "1";
const CHAT_PROFILE_COMMIT_BUDGET_MS = 16;
const CHAT_PROFILE_ACTION_BAR_BUDGET_MS = 50;
const CHAT_PROFILE_LOG_INTERVAL_MS = 45000;
const CHAT_PARSED_MESSAGE_CACHE_LIMIT = 2000;

type UploadableImageMimeType = "image/jpeg" | "image/png" | "image/webp";

const normalizedReactionsCache = new WeakMap<GlobalChatReaction[], GlobalChatReaction[]>();
const orderedReactionsForDisplayCache = new WeakMap<GlobalChatReaction[], GlobalChatReaction[]>();
const reactionSignatureCache = new WeakMap<GlobalChatReaction[], string>();
const parsedMessageByRawMessageCache = new Map<string, ParsedChatMessage>();

const isNearBottom = (element: HTMLDivElement): boolean => {
  const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
  return distanceFromBottom <= CHAT_AUTO_SCROLL_THRESHOLD_PX;
};

const toMessageId = (value: unknown): number => {
  const normalized = typeof value === "number"
    ? value
    : Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(normalized) ? normalized : 0;
};

const normalizeReactionUserLabel = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const normalizeMessageReactions = (
  value: GlobalChatReaction[] | null | undefined,
): GlobalChatReaction[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  const cachedReactions = normalizedReactionsCache.get(value);
  if (cachedReactions) {
    return cachedReactions;
  }

  const usersByEmoji = new Map<string, Map<string, string>>();
  for (const reaction of value) {
    const emoji = typeof reaction?.emoji === "string" ? reaction.emoji.trim() : "";
    if (!emoji) {
      continue;
    }

    const existingUsers = usersByEmoji.get(emoji) ?? new Map<string, string>();
    const users = Array.isArray(reaction?.users) ? reaction.users : [];
    for (const user of users) {
      const userId = typeof user?.userId === "string" ? user.userId.trim() : "";
      const label = typeof user?.label === "string" ? normalizeReactionUserLabel(user.label) : "";
      if (!userId || !label || existingUsers.has(userId)) {
        continue;
      }
      existingUsers.set(userId, label);
    }

    if (existingUsers.size > 0) {
      usersByEmoji.set(emoji, existingUsers);
    }
  }

  const normalizedReactions = [...usersByEmoji.entries()].map(([emoji, users]) => ({
    emoji,
    users: [...users.entries()].map(([userId, label]) => ({
      userId,
      label,
    })),
  }));
  normalizedReactionsCache.set(value, normalizedReactions);
  return normalizedReactions;
};

const withNormalizedMessageReactions = (entry: GlobalChatMessage): GlobalChatMessage => ({
  ...entry,
  reactions: normalizeMessageReactions(entry.reactions),
});

const reactionSignature = (reactions: GlobalChatReaction[] | null | undefined): string => {
  const normalizedReactions = normalizeMessageReactions(reactions);
  if (normalizedReactions.length === 0) {
    return "";
  }
  const cachedSignature = reactionSignatureCache.get(normalizedReactions);
  if (typeof cachedSignature === "string") {
    return cachedSignature;
  }
  const signature = normalizedReactions
    .map((reaction) => {
      const users = [...reaction.users]
        .map((user) => `${user.userId}:${user.label}`)
        .sort()
        .join(",");
      return `${reaction.emoji}:${users}`;
    })
    .sort()
    .join("|");
  reactionSignatureCache.set(normalizedReactions, signature);
  return signature;
};

const quickReactionOrder = (emoji: string): number =>
  CHAT_QUICK_REACTIONS.indexOf(emoji as (typeof CHAT_QUICK_REACTIONS)[number]);

const orderReactionsForDisplay = (reactions: GlobalChatReaction[]): GlobalChatReaction[] => {
  if (reactions.length === 0) {
    return [];
  }
  const cachedOrder = orderedReactionsForDisplayCache.get(reactions);
  if (cachedOrder) {
    return cachedOrder;
  }

  const quick: GlobalChatReaction[] = [];
  const other: GlobalChatReaction[] = [];
  for (const reaction of reactions) {
    if (quickReactionOrder(reaction.emoji) >= 0) {
      quick.push(reaction);
    } else {
      other.push(reaction);
    }
  }

  quick.sort((left, right) => quickReactionOrder(left.emoji) - quickReactionOrder(right.emoji));
  other.sort((left, right) => left.emoji.localeCompare(right.emoji));
  const orderedReactions = [...quick, ...other];
  orderedReactionsForDisplayCache.set(reactions, orderedReactions);
  return orderedReactions;
};

const hasReactionFromUser = (
  reaction: GlobalChatReaction | undefined,
  userId: string,
): boolean => Boolean(reaction?.users.some((entry) => entry.userId === userId));

const reactionStateKey = (messageId: number, emoji: string): string => `${messageId}:${emoji}`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const formatOptimisticReactionLabel = (value: string): string => {
  const compact = compactSenderLabel(value).replace(/\s+/g, " ").trim();
  if (!compact) {
    return "You";
  }
  const parts = compact.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return parts[0];
  }
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1]?.[0]?.toUpperCase();
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
};

const upsertReactionUsersForEmoji = ({
  reactions,
  emoji,
  users,
}: {
  reactions: GlobalChatReaction[];
  emoji: string;
  users: GlobalChatReaction["users"] | null;
}): GlobalChatReaction[] => {
  const normalizedEmoji = emoji.trim();
  if (!normalizedEmoji) {
    return normalizeMessageReactions(reactions);
  }

  const nextUsersMap = new Map<string, string>();
  for (const entry of users ?? []) {
    const userId = entry.userId.trim();
    const label = entry.label.trim();
    if (!userId || !label || nextUsersMap.has(userId)) {
      continue;
    }
    nextUsersMap.set(userId, label);
  }

  const withoutEmoji = normalizeMessageReactions(reactions).filter(
    (entry) => entry.emoji !== normalizedEmoji,
  );
  if (nextUsersMap.size === 0) {
    return withoutEmoji;
  }

  return normalizeMessageReactions([
    ...withoutEmoji,
    {
      emoji: normalizedEmoji,
      users: [...nextUsersMap.entries()].map(([userId, label]) => ({
        userId,
        label,
      })),
    },
  ]);
};

const toRealtimeMessagePayload = (value: unknown): GlobalChatMessage | null => {
  const row = asRecord(value);
  if (!row) {
    return null;
  }

  const id = toMessageId(row.id);
  const userId = asTrimmedString(row.user_id);
  const senderLabel = asTrimmedString(row.sender_label);
  const message = typeof row.message === "string" ? row.message : "";
  const imageUrlRaw = typeof row.image_url === "string" ? row.image_url : null;
  const imageUrl = normalizeChatImageUrl(imageUrlRaw);
  const createdAt = asTrimmedString(row.created_at);

  if (!id || !userId || !senderLabel || (!normalizeChatInlineText(message) && !imageUrl) || !createdAt) {
    return null;
  }

  return withNormalizedMessageReactions({
    id,
    userId,
    senderLabel,
    senderAvatarUrl: typeof row.sender_avatar_url === "string" ? row.sender_avatar_url : null,
    senderAvatarBorderColor: typeof row.sender_avatar_border_color === "string"
      ? row.sender_avatar_border_color
      : null,
    message,
    imageUrl,
    reactions: [],
    createdAt,
  });
};

const messageIdFromReactionRealtimePayload = (value: unknown): number => {
  const payload = asRecord(value);
  if (!payload) {
    return 0;
  }
  const next = asRecord(payload.new);
  const previous = asRecord(payload.old);
  return toMessageId(next?.message_id ?? previous?.message_id ?? 0);
};

const mergeIncomingMessages = (
  existing: GlobalChatMessage[],
  incoming: GlobalChatMessage[],
): { messages: GlobalChatMessage[]; droppedCount: number } => {
  if (incoming.length === 0) {
    return { messages: existing, droppedCount: 0 };
  }

  const knownIds = new Set(existing.map((entry) => toMessageId(entry.id)));
  let droppedCount = 0;
  const additions = incoming.filter((entry) => {
    const messageId = toMessageId(entry.id);
    if (knownIds.has(messageId)) {
      droppedCount += 1;
      return false;
    }
    knownIds.add(messageId);
    return true;
  });

  if (additions.length === 0) {
    return { messages: existing, droppedCount };
  }

  return {
    messages: [...existing, ...additions],
    droppedCount,
  };
};

const prependOlderMessages = (
  existing: GlobalChatMessage[],
  older: GlobalChatMessage[],
): { messages: GlobalChatMessage[]; droppedCount: number } => {
  if (older.length === 0) {
    return { messages: existing, droppedCount: 0 };
  }

  const knownIds = new Set(existing.map((entry) => toMessageId(entry.id)));
  let droppedCount = 0;
  const olderUnique = older.filter((entry) => {
    const messageId = toMessageId(entry.id);
    if (knownIds.has(messageId)) {
      droppedCount += 1;
      return false;
    }
    knownIds.add(messageId);
    return true;
  });

  if (olderUnique.length === 0) {
    return { messages: existing, droppedCount };
  }

  return {
    messages: [...olderUnique, ...existing],
    droppedCount,
  };
};

const isBrowserOnline = (): boolean =>
  typeof navigator === "undefined" || navigator.onLine;

const generateIdempotencyKey = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const validateChatImageFileBase = (file: File): string | null => {
  const mimeType = file.type.trim().toLowerCase();
  if (!isSupportedChatImageMimeType(mimeType)) {
    return "Use a JPG, PNG, or WEBP image.";
  }
  if (file.size <= 0) {
    return "Image file is empty.";
  }
  return null;
};

const validateChatImageFile = (file: File): string | null => {
  const baseError = validateChatImageFileBase(file);
  if (baseError) {
    return baseError;
  }
  if (file.size > MAX_CHAT_IMAGE_BYTES) {
    return "Image must be 3MB or smaller.";
  }
  return null;
};

const toUploadableImageMimeType = (mimeType: string): UploadableImageMimeType => {
  if (mimeType === "image/png") {
    return "image/png";
  }
  if (mimeType === "image/webp") {
    return "image/webp";
  }
  return "image/jpeg";
};

const extensionFromUploadableMimeType = (mimeType: UploadableImageMimeType): string => {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "jpg";
};

const deriveChatImageFileName = ({
  originalName,
  mimeType,
}: {
  originalName: string;
  mimeType: UploadableImageMimeType;
}): string => {
  const fallbackName = "chat-image";
  const baseName = originalName.replace(/\.[^/.]+$/, "").trim() || fallbackName;
  return `${baseName}.${extensionFromUploadableMimeType(mimeType)}`;
};

const loadImageElement = (blob: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const image = document.createElement("img");
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Unable to process image."));
    };
    image.src = objectUrl;
  });

const renderImageBlob = ({
  image,
  width,
  height,
  mimeType,
  quality,
}: {
  image: HTMLImageElement;
  width: number;
  height: number;
  mimeType: UploadableImageMimeType;
  quality?: number;
}): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("Unable to process image."));
      return;
    }

    context.drawImage(image, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to process image."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality,
    );
  });

const optimizeChatImageFileForUpload = async (file: File): Promise<File> => {
  if (typeof document === "undefined") {
    return file;
  }

  const originalMimeType = toUploadableImageMimeType(file.type.trim().toLowerCase());
  const targetMimeType: UploadableImageMimeType =
    originalMimeType === "image/png" && file.size > MAX_CHAT_IMAGE_BYTES ? "image/webp" : originalMimeType;

  let image: HTMLImageElement;
  try {
    image = await loadImageElement(file);
  } catch {
    return file;
  }

  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;
  if (originalWidth <= 0 || originalHeight <= 0) {
    return file;
  }

  const longestEdge = Math.max(originalWidth, originalHeight);
  const baseScale = longestEdge > CHAT_UPLOAD_IMAGE_MAX_DIMENSION_PX
    ? CHAT_UPLOAD_IMAGE_MAX_DIMENSION_PX / longestEdge
    : 1;

  const baseWidth = Math.max(1, Math.round(originalWidth * baseScale));
  const baseHeight = Math.max(1, Math.round(originalHeight * baseScale));
  const shouldTransform = baseScale < 1 || file.size > MAX_CHAT_IMAGE_BYTES || targetMimeType !== originalMimeType;
  if (!shouldTransform) {
    return file;
  }

  const qualitySteps: Array<number | undefined> = targetMimeType === "image/png"
    ? [undefined]
    : [...CHAT_UPLOAD_IMAGE_QUALITY_STEPS];
  let bestCandidate: Blob | null = null;

  for (const scaleStep of CHAT_UPLOAD_IMAGE_SCALE_STEPS) {
    const width = Math.max(1, Math.round(baseWidth * scaleStep));
    const height = Math.max(1, Math.round(baseHeight * scaleStep));
    for (const quality of qualitySteps) {
      let blob: Blob;
      try {
        blob = await renderImageBlob({
          image,
          width,
          height,
          mimeType: targetMimeType,
          quality,
        });
      } catch {
        continue;
      }

      if (!bestCandidate || blob.size < bestCandidate.size) {
        bestCandidate = blob;
      }
      if (blob.size <= MAX_CHAT_IMAGE_BYTES) {
        return new File([blob], deriveChatImageFileName({
          originalName: file.name,
          mimeType: targetMimeType,
        }), {
          type: targetMimeType,
          lastModified: Date.now(),
        });
      }
    }
  }

  if (!bestCandidate) {
    return file;
  }

  return new File([bestCandidate], deriveChatImageFileName({
    originalName: file.name,
    mimeType: targetMimeType,
  }), {
    type: targetMimeType,
    lastModified: Date.now(),
  });
};

const extractImageFileFromClipboard = (clipboardData: DataTransfer): File | null => {
  const items = Array.from(clipboardData.items);
  for (const item of items) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (file && file.type.toLowerCase().startsWith("image/")) {
      return file;
    }
  }
  return null;
};

const normalizeClipboardImageUrl = (value: string): string | null => {
  const normalized = normalizeChatImageUrl(value);
  if (!normalized) {
    return null;
  }
  return IMAGE_URL_EXTENSION_PATTERN.test(normalized) ? normalized : null;
};

const extractImageUrlFromClipboard = (clipboardData: DataTransfer): string | null => {
  const html = clipboardData.getData("text/html").trim();
  if (html && typeof DOMParser !== "undefined") {
    try {
      const parser = new DOMParser();
      const documentNode = parser.parseFromString(html, "text/html");
      const rawImageUrl = documentNode.querySelector("img")?.getAttribute("src") ?? "";
      const normalized = normalizeChatImageUrl(rawImageUrl);
      if (normalized) {
        return normalized;
      }
    } catch {
      // Ignore malformed clipboard html.
    }
  }

  const plainText = clipboardData.getData("text/plain").trim();
  if (!plainText) {
    return null;
  }
  return normalizeClipboardImageUrl(plainText);
};

const getImageFileNameFromUrl = (imageUrl: string): string => {
  try {
    const parsed = new URL(imageUrl);
    const segment = parsed.pathname.split("/").filter(Boolean).at(-1)?.trim() ?? "";
    if (!segment) {
      return "pasted-image";
    }
    const decoded = decodeURIComponent(segment).replace(/[?#].*$/, "");
    return decoded || "pasted-image";
  } catch {
    return "pasted-image";
  }
};

const formatTime = (value: string): string =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const formatDayKey = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown-day";
  }
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const formatDayLabel = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDifference = Math.round((startOfToday - startOfDate) / (24 * 60 * 60 * 1000));

  if (dayDifference === 0) {
    return "Today";
  }
  if (dayDifference === 1) {
    return "Yesterday";
  }

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

const initialsForSenderLabel = (value: string): string => {
  const preferredSource = value.match(/\(([^)]+)\)/)?.[1] ?? value;
  return (
    preferredSource
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
};

const compactSenderLabel = (value: string): string => {
  const preferredSource = value.match(/\(([^)]+)\)/)?.[1] ?? value;
  return preferredSource.trim() || value.trim();
};

const normalizeChatInlineText = (value: string): string => value.replace(/\s+/g, " ").trim();

const clampChatInlineText = (value: string, maxLength: number): string => {
  const normalized = normalizeChatInlineText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const sanitizeReplySenderLabel = (value: string): string => {
  const compact = compactSenderLabel(value) || "Unknown";
  return clampChatInlineText(compact, CHAT_REPLY_SENDER_MAX_LENGTH) || "Unknown";
};

const sanitizeReplySnippet = (value: string): string => {
  const compact = clampChatInlineText(value, CHAT_REPLY_SNIPPET_MAX_LENGTH);
  return compact || "Message";
};

const safeDecodeUriComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const buildReplyToken = (replyContext: ChatReplyContext): string => {
  const normalizedMessageId = Math.max(1, Math.floor(replyContext.messageId));
  const encodedSender = encodeURIComponent(sanitizeReplySenderLabel(replyContext.senderLabel));
  const encodedSnippet = encodeURIComponent(sanitizeReplySnippet(replyContext.snippet));
  return `[rq:${normalizedMessageId}:${encodedSender}:${encodedSnippet}]`;
};

const encodeMessageWithReplyContext = ({
  message,
  replyContext,
}: {
  message: string;
  replyContext: ChatReplyContext | null;
}): string => {
  const normalizedMessage = normalizeChatInlineText(message);
  if (!replyContext) {
    return normalizedMessage;
  }
  const token = buildReplyToken(replyContext);
  return normalizedMessage ? `${token} ${normalizedMessage}` : token;
};

const parseMessageWithReplyContext = (message: string): ParsedChatMessage => {
  const rawMessage = typeof message === "string" ? message : "";
  const cachedParsedMessage = parsedMessageByRawMessageCache.get(rawMessage);
  if (cachedParsedMessage) {
    return cachedParsedMessage;
  }

  const match = rawMessage.match(CHAT_REPLY_TOKEN_PATTERN);
  let parsedMessage: ParsedChatMessage;
  if (!match) {
    parsedMessage = {
      body: rawMessage,
      replyContext: null,
    };
  } else {
    const messageId = Number.parseInt(match[1] ?? "", 10);
    if (!Number.isFinite(messageId) || messageId <= 0) {
      parsedMessage = {
        body: rawMessage,
        replyContext: null,
      };
    } else {
      const decodedSender = sanitizeReplySenderLabel(safeDecodeUriComponent(match[2] ?? ""));
      const decodedSnippet = sanitizeReplySnippet(safeDecodeUriComponent(match[3] ?? ""));
      const body = rawMessage.slice(match[0].length);

      parsedMessage = {
        body,
        replyContext: {
          messageId,
          senderLabel: decodedSender,
          snippet: decodedSnippet,
        },
      };
    }
  }

  if (parsedMessageByRawMessageCache.size >= CHAT_PARSED_MESSAGE_CACHE_LIMIT) {
    const oldestEntry = parsedMessageByRawMessageCache.keys().next();
    if (!oldestEntry.done && typeof oldestEntry.value === "string") {
      parsedMessageByRawMessageCache.delete(oldestEntry.value);
    }
  }
  parsedMessageByRawMessageCache.set(rawMessage, parsedMessage);
  return parsedMessage;
};

const replySnippetFromMessage = ({
  message,
  imageUrl,
}: {
  message: string;
  imageUrl: string | null;
}): string => {
  const parsedMessage = parseMessageWithReplyContext(message);
  const normalizedBody = normalizeChatInlineText(parsedMessage.body);
  if (normalizedBody) {
    return sanitizeReplySnippet(normalizedBody);
  }
  if (imageUrl) {
    return "Image";
  }
  return "Message";
};

const maxComposerLengthForReply = (replyContext: ChatReplyContext | null): number => {
  if (!replyContext) {
    return MAX_GLOBAL_CHAT_MESSAGE_LENGTH;
  }
  const reservedLength = buildReplyToken(replyContext).length + 1;
  return Math.max(0, MAX_GLOBAL_CHAT_MESSAGE_LENGTH - reservedLength);
};

const INITIAL_CHAT_STORE_STATE: ChatStoreState = {
  messages: [],
  hasOlderMessages: false,
  oldestCursorId: null,
};

const chatStoreReducer = (state: ChatStoreState, action: ChatStoreAction): ChatStoreState => {
  if (action.type === "replace") {
    return {
      messages: action.messages,
      hasOlderMessages: action.hasOlderMessages,
      oldestCursorId: action.oldestCursorId,
    };
  }

  if (action.type === "updateMessages") {
    const nextMessages = action.updater(state.messages);
    if (nextMessages === state.messages) {
      return state;
    }
    return {
      ...state,
      messages: nextMessages,
    };
  }

  if (
    state.hasOlderMessages === action.hasOlderMessages &&
    state.oldestCursorId === action.oldestCursorId
  ) {
    return state;
  }
  return {
    ...state,
    hasOlderMessages: action.hasOlderMessages,
    oldestCursorId: action.oldestCursorId,
  };
};

const estimateMessageHeightForVirtualization = ({
  entry,
  isEmbedded,
}: {
  entry: GlobalChatMessage;
  isEmbedded: boolean;
}): number => {
  const parsedEntryMessage = parseMessageWithReplyContext(entry.message);
  const trimmedMessage = normalizeChatInlineText(parsedEntryMessage.body);
  const lineCharCount = isEmbedded ? 24 : 30;
  const lineHeight = isEmbedded ? 15 : 18;
  const textLineCount = trimmedMessage.length > 0
    ? Math.max(1, Math.ceil(trimmedMessage.length / lineCharCount))
    : 0;
  const textHeight = textLineCount * lineHeight;
  const replyHeight = parsedEntryMessage.replyContext ? 48 : 0;
  const imageHeight = entry.imageUrl ? 180 : 0;
  const reactionHeight = entry.reactions.length > 0 ? 24 : 0;
  const bubblePaddingHeight = entry.imageUrl ? 12 : isEmbedded ? 18 : 24;
  const metaHeight = 14;
  return bubblePaddingHeight + textHeight + replyHeight + imageHeight + reactionHeight + metaHeight;
};

const estimateGroupHeightForVirtualization = ({
  group,
  showDaySeparator,
  isEmbedded,
}: {
  group: {
    isCurrentUser: boolean;
    senderLabel: string;
    messages: GlobalChatMessage[];
  };
  showDaySeparator: boolean;
  isEmbedded: boolean;
}): number => {
  let totalHeight = 0;
  if (showDaySeparator) {
    totalHeight += isEmbedded ? 18 : 24;
  }
  if (!group.isCurrentUser && group.senderLabel.trim().length > 0) {
    totalHeight += isEmbedded ? 15 : 18;
  }
  for (const entry of group.messages) {
    totalHeight += estimateMessageHeightForVirtualization({
      entry,
      isEmbedded,
    }) + 12;
  }
  return totalHeight + 8;
};

const estimateBlockHeight = ({
  block,
  loadingOlder,
}: {
  block: ChatRenderBlock;
  loadingOlder: boolean;
}): number => {
  if (block.type === "older") {
    return loadingOlder ? 56 : 52;
  }
  if (block.type === "empty") {
    return 40;
  }
  return block.estimatedHeight;
};

const ChatMeasuredBlock = ({
  blockKey,
  absoluteTop,
  onMeasuredHeight,
  children,
}: {
  blockKey: string;
  absoluteTop: number | null;
  onMeasuredHeight: (blockKey: string, nextHeight: number) => void;
  children: ReactNode;
}) => {
  const blockRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = blockRef.current;
    if (!node) {
      return;
    }

    const measure = () => {
      const nextHeight = Math.max(1, Math.round(node.getBoundingClientRect().height));
      onMeasuredHeight(blockKey, nextHeight);
    };

    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [blockKey, onMeasuredHeight]);

  return (
    <div
      ref={blockRef}
      className="w-full"
      style={absoluteTop === null ? undefined : {
        left: 0,
        position: "absolute",
        right: 0,
        top: absoluteTop,
      }}
    >
      {children}
    </div>
  );
};

type ChatMessageGroupBlockProps = {
  group: ChatMessageGroup;
  previousGroupDayKey: string | null;
  isEmbedded: boolean;
  currentUserId: string;
  hoveredActionBarMessageId: number | null;
  hiddenActionBarMessageId: number | null;
  pendingReactionByMessageId: Map<number, Set<string>>;
  pendingReactionSignature: string;
  showActionBarForMessage: (messageId: number) => void;
  queueHideActionBarForMessage: (messageId: number) => void;
  toggleMessageReaction: ({
    messageId,
    emoji,
    closeActionBar,
  }: {
    messageId: number;
    emoji: string;
    closeActionBar?: boolean;
  }) => Promise<void>;
  handleReplyToMessage: (entry: GlobalChatMessage) => void;
  handleCopyMessage: (entry: GlobalChatMessage) => Promise<void>;
  handleMoreMessageAction: (entry: GlobalChatMessage) => Promise<void>;
  openImageLightbox: (entry: GlobalChatMessage) => void;
};

const ChatMessageGroupBlock = memo(({
  group,
  previousGroupDayKey,
  isEmbedded,
  currentUserId,
  hoveredActionBarMessageId,
  hiddenActionBarMessageId,
  pendingReactionByMessageId,
  showActionBarForMessage,
  queueHideActionBarForMessage,
  toggleMessageReaction,
  handleReplyToMessage,
  handleCopyMessage,
  handleMoreMessageAction,
  openImageLightbox,
}: ChatMessageGroupBlockProps) => {
  const showDaySeparator = previousGroupDayKey !== group.dayKey;
  const senderLabel = compactSenderLabel(group.senderLabel);
  const activeActionBarMessageId = hoveredActionBarMessageId;
  const hasVisibleActionBar = (
    activeActionBarMessageId !== null &&
    hiddenActionBarMessageId !== activeActionBarMessageId
  );

  return (
    <div className="space-y-1 pb-3.5 last:pb-0">
      {showDaySeparator ? (
        <div className={isEmbedded ? "my-1 flex items-center gap-1.5 px-0.5" : "my-2 flex items-center gap-2 px-1"}>
          <span className="h-px flex-1 bg-white/10" />
          <span className={isEmbedded ? "text-[9px] font-medium tracking-wide text-[#9fb3d6]/65" : "text-[10px] font-medium tracking-wide text-[#9fb3d6]/70"}>
            {group.dayLabel}
          </span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
      ) : null}
      {!group.isCurrentUser ? (
        <p
          className={isEmbedded
            ? "px-8 text-left text-[10px] font-medium tracking-wide text-white/40"
            : "px-10 text-left text-[11px] font-medium tracking-wide text-white/40"}
          title={group.senderLabel}
        >
          {senderLabel}
        </p>
      ) : null}
      <div className="space-y-1">
        {group.messages.map((entry, index) => {
          const isFirstInGroup = index === 0;
          const isLastInGroup = index === group.messages.length - 1;
          const isMiddleInGroup = !isFirstInGroup && !isLastInGroup;
          const shouldShowTimestamp = isLastInGroup;
          const showAvatar = isFirstInGroup;
          const entryMessageId = toMessageId(entry.id);
          const isPersistedMessage = entryMessageId > 0;
          const entryReactions = orderReactionsForDisplay(entry.reactions);
          const entryReactionByEmoji = new Map(entryReactions.map((reaction) => [reaction.emoji, reaction]));
          const isActionBarHoverTarget = hoveredActionBarMessageId === entryMessageId;
          const isActionBarVisible = (
            isPersistedMessage &&
            isActionBarHoverTarget &&
            hiddenActionBarMessageId !== entryMessageId
          );
          const suppressEntryPointerEvents = (
            hasVisibleActionBar &&
            activeActionBarMessageId !== entryMessageId
          );
          const hasVisibleMetaContent = shouldShowTimestamp;
          const messageMetaSpacingClass = entryReactions.length > 0
            ? "mt-[14px]"
            : hasVisibleMetaContent
            ? "mt-px"
            : "mt-0";
          const parsedEntryMessage = parseMessageWithReplyContext(entry.message);
          const trimmedMessage = normalizeChatInlineText(parsedEntryMessage.body);
          const entryReplyContext = parsedEntryMessage.replyContext;
          const isImageOnlyMessage = Boolean(entry.imageUrl) && trimmedMessage.length === 0 && !entryReplyContext;
          const groupedCornerClass = group.isCurrentUser
            ? isMiddleInGroup
              ? "rounded-[20px] rounded-tr-[8px] rounded-br-[8px]"
              : isFirstInGroup && !isLastInGroup
              ? "rounded-[20px] rounded-br-[8px]"
              : !isFirstInGroup && isLastInGroup
              ? "rounded-[20px] rounded-tr-[8px]"
              : "rounded-[20px]"
            : isMiddleInGroup
            ? "rounded-[20px] rounded-tl-[8px] rounded-bl-[8px]"
            : isFirstInGroup && !isLastInGroup
            ? "rounded-[20px] rounded-bl-[8px]"
            : !isFirstInGroup && isLastInGroup
            ? "rounded-[20px] rounded-tl-[8px]"
            : "rounded-[20px]";
          const avatarBorderStyle = group.senderAvatarBorderColor
            ? { outlineColor: group.senderAvatarBorderColor }
            : undefined;
          const avatar = showAvatar ? (
            <span
              className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[#16233a]"
              style={avatarBorderStyle}
            >
              {group.senderAvatarUrl ? (
                <Image
                  src={group.senderAvatarUrl}
                  alt={`${group.senderLabel} avatar`}
                  fill
                  sizes="28px"
                  className="object-cover object-center"
                />
              ) : (
                <span className="inline-flex h-full w-full items-center justify-center text-[10px] font-semibold text-[#d7e5ff]">
                  {initialsForSenderLabel(group.senderLabel)}
                </span>
              )}
            </span>
          ) : (
            <span className="h-7 w-7 shrink-0" />
          );

          const pendingReactionsForMessage = pendingReactionByMessageId.get(entryMessageId);

          const bubble = (
            <div
              className={`group/message relative flex flex-col ${
                entry.imageUrl ? "max-w-[70%]" : "max-w-[74%]"
              } ${
                group.isCurrentUser ? "items-end" : "items-start"
              } ${
                isPersistedMessage ? "" : "opacity-85"
              } ${
                isActionBarHoverTarget ? "z-40" : "z-0"
              } ${
                suppressEntryPointerEvents ? "pointer-events-none" : ""
              }`}
              style={entry.imageUrl ? { maxWidth: "min(260px, 70%)" } : undefined}
              onMouseEnter={() => {
                if (!isPersistedMessage) {
                  return;
                }
                showActionBarForMessage(entryMessageId);
              }}
              onMouseLeave={() => {
                if (!isPersistedMessage) {
                  return;
                }
                queueHideActionBarForMessage(entryMessageId);
              }}
            >
              <div
                className={`absolute top-0 z-50 -mt-1.5 -translate-y-full inline-flex items-center gap-0.5 overflow-hidden rounded-full shadow-[0_8px_20px_rgba(0,0,0,0.28)] transition-all duration-300 ease-in-out ${
                  group.isCurrentUser ? "right-1" : "left-1"
                } ${
                  isActionBarVisible
                    ? "pointer-events-auto max-h-8 max-w-[12rem] border border-white/10 bg-[#0f1c32]/88 px-1 py-0.5 opacity-100"
                    : "pointer-events-none max-h-0 max-w-0 border-transparent bg-transparent px-0 py-0 opacity-0"
                }`}
                onMouseEnter={() => {
                  if (!isPersistedMessage) {
                    return;
                  }
                  showActionBarForMessage(entryMessageId);
                }}
                onMouseLeave={() => {
                  if (!isPersistedMessage) {
                    return;
                  }
                  queueHideActionBarForMessage(entryMessageId);
                }}
              >
                {CHAT_QUICK_REACTIONS.map((emoji) => {
                  const reaction = entryReactionByEmoji.get(emoji);
                  const hasCurrentUserReaction = hasReactionFromUser(reaction, currentUserId);
                  const isReactionPending = pendingReactionsForMessage?.has(emoji) === true;
                  return (
                    <button
                      key={`${entryMessageId}-quick-${emoji}`}
                      aria-label={`${hasCurrentUserReaction ? "Remove" : "React with"} ${emoji}`}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[14px] leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/70 ${
                        hasCurrentUserReaction ? "bg-white/16" : "hover:bg-white/12"
                      } ${
                        isReactionPending ? "cursor-not-allowed opacity-55" : ""
                      }`}
                      disabled={isReactionPending}
                      type="button"
                      onClick={() => {
                        void toggleMessageReaction({
                          messageId: entryMessageId,
                          emoji,
                          closeActionBar: true,
                        });
                      }}
                    >
                      {emoji}
                    </button>
                  );
                })}
                <Button
                  isIconOnly
                  aria-label="Reply"
                  className="h-6 w-6 min-h-6 min-w-6 text-[#b9cae7] data-[hover=true]:bg-white/10 data-[hover=true]:text-white"
                  size="sm"
                  variant="light"
                  onPress={() => {
                    handleReplyToMessage(entry);
                  }}
                >
                  <Reply className="h-3.5 w-3.5" />
                </Button>
                <Button
                  isIconOnly
                  aria-label="Copy message"
                  className="h-6 w-6 min-h-6 min-w-6 text-[#b9cae7] data-[hover=true]:bg-white/10 data-[hover=true]:text-white"
                  size="sm"
                  variant="light"
                  onPress={() => {
                    void handleCopyMessage(entry);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
                <Button
                  isIconOnly
                  aria-label={entry.imageUrl ? "Open image" : "More actions"}
                  className="h-6 w-6 min-h-6 min-w-6 text-[#b9cae7] data-[hover=true]:bg-white/10 data-[hover=true]:text-white"
                  size="sm"
                  variant="light"
                  onPress={() => {
                    void handleMoreMessageAction(entry);
                  }}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="relative">
                <div
                  className={`overflow-hidden ${
                    isImageOnlyMessage
                      ? "bg-transparent p-0"
                      : entry.imageUrl
                      ? "p-0"
                      : isEmbedded
                      ? "px-2 py-1.5"
                      : "px-2.5 py-1.5"
                  } ${!isImageOnlyMessage ? groupedCornerClass : ""} ${
                    !isImageOnlyMessage ? (
                    group.isCurrentUser
                      ? "bg-white/8 text-[#f4f8ff] transition-colors group-hover/message:bg-white/10"
                      : "bg-white/6 text-[#e8efff] transition-colors group-hover/message:bg-white/8"
                  ) : ""}`}
                >
                  {entryReplyContext ? (
                    <div className="mb-1.5 rounded-[12px] border border-white/10 bg-black/20 px-2 py-1.5">
                      <p className="truncate text-[10px] font-medium text-[#a6b8d8]/90">
                        {entryReplyContext.senderLabel}
                      </p>
                      <p className="truncate text-[11px] text-[#d6e3fa]/78">
                        {entryReplyContext.snippet}
                      </p>
                    </div>
                  ) : null}
                  {entry.imageUrl ? (
                    <button
                      aria-label="Open image viewer"
                      className="block w-full text-left"
                      type="button"
                      onClick={() => {
                        openImageLightbox(entry);
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="Chat attachment"
                        className={`max-h-[260px] w-full object-cover ${
                          isImageOnlyMessage
                            ? "rounded-[18px] bg-transparent drop-shadow-[0_3px_10px_rgba(0,0,0,0.34)]"
                            : ""
                        }`}
                        loading="lazy"
                        src={entry.imageUrl}
                      />
                    </button>
                  ) : null}
                  {trimmedMessage ? (
                    <p
                      className={`whitespace-pre-wrap break-words ${
                        isEmbedded
                          ? "text-[12px] leading-[1.15rem]"
                          : "text-[13px] leading-[1.35rem] sm:text-sm"
                      } ${
                        entry.imageUrl ? "px-2.5 py-2" : ""
                      }`}
                    >
                      {trimmedMessage}
                    </p>
                  ) : null}
                </div>
                {entryReactions.length > 0 ? (
                  <div className={`absolute bottom-0 z-10 inline-flex items-center gap-0.5 translate-y-[75%] ${
                    group.isCurrentUser ? "right-1" : "left-1"
                  }`}>
                    {entryReactions.map((reaction) => {
                      const isReactionPending = pendingReactionsForMessage?.has(reaction.emoji) === true;
                      const hasCurrentUserReaction = hasReactionFromUser(reaction, currentUserId);
                      const tooltipContent = reaction.users
                        .map((user) => user.label)
                        .filter(Boolean)
                        .join(", ");

                      return (
                        <Tooltip
                          key={`${entryMessageId}-reaction-${reaction.emoji}`}
                          content={tooltipContent || "Reaction"}
                          placement="top"
                        >
                          <button
                            aria-label={`${hasCurrentUserReaction ? "Remove" : "Add"} ${reaction.emoji} reaction`}
                            className={`inline-flex h-6 w-6 items-center justify-center text-[15px] leading-none transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/70 ${
                              isReactionPending ? "cursor-not-allowed opacity-55" : "hover:scale-110"
                            }`}
                            disabled={isReactionPending}
                            type="button"
                            onClick={() => {
                              void toggleMessageReaction({
                                messageId: entryMessageId,
                                emoji: reaction.emoji,
                              });
                            }}
                          >
                            {reaction.emoji}
                          </button>
                        </Tooltip>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div
                className={`${messageMetaSpacingClass} flex items-center gap-1 px-1 ${
                  group.isCurrentUser ? "justify-end" : "justify-start"
                }`}
              >
                {shouldShowTimestamp ? (
                  <p className={`text-[10px] text-[#9fb3d6]/46 transition-opacity duration-300 ease-in-out [@media(hover:none)]:opacity-45 ${
                    isActionBarVisible ? "opacity-100" : "opacity-0"
                  }`}>
                    {isPersistedMessage ? formatTime(entry.createdAt) : "Sending..."}
                  </p>
                ) : null}
              </div>
            </div>
          );

          return (
            <div
              key={entry.id}
              className={`relative flex items-end gap-1.5 px-0.5 ${
                group.isCurrentUser ? "justify-end" : "justify-start"
              } ${
                isActionBarHoverTarget ? "z-50" : "z-0"
              }`}
            >
              {group.isCurrentUser ? (
                bubble
              ) : (
                <>
                  {avatar}
                  {bubble}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}, (previousProps, nextProps) => (
  previousProps.group.renderSignature === nextProps.group.renderSignature &&
  previousProps.previousGroupDayKey === nextProps.previousGroupDayKey &&
  previousProps.isEmbedded === nextProps.isEmbedded &&
  previousProps.currentUserId === nextProps.currentUserId &&
  previousProps.hoveredActionBarMessageId === nextProps.hoveredActionBarMessageId &&
  previousProps.hiddenActionBarMessageId === nextProps.hiddenActionBarMessageId &&
  previousProps.pendingReactionSignature === nextProps.pendingReactionSignature
));
ChatMessageGroupBlock.displayName = "ChatMessageGroupBlock";

export const GlobalChatPanel = ({
  currentUserId,
  className,
  mode = "floating",
  hideOnMobile = false,
  isOpen: isOpenProp,
  onOpenChange,
  onUnreadCountChange,
  hideLauncherButton = false,
}: {
  currentUserId: string;
  className?: string;
  mode?: "floating" | "embedded";
  hideOnMobile?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onUnreadCountChange?: (count: number) => void;
  hideLauncherButton?: boolean;
}) => {
  const isEmbedded = mode === "embedded";
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false);
  const setPanelOpen = useCallback((nextOpen: boolean) => {
    if (isOpenProp === undefined) {
      setUncontrolledIsOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  }, [isOpenProp, onOpenChange]);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [chatStore, dispatchChatStore] = useReducer(chatStoreReducer, INITIAL_CHAT_STORE_STATE);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [replyContext, setReplyContext] = useState<ChatReplyContext | null>(null);
  const [pendingReactionByKey, setPendingReactionByKey] = useState<Record<string, boolean>>({});
  const [hoveredActionBarMessageId, setHoveredActionBarMessageId] = useState<number | null>(null);
  const [hiddenActionBarMessageId, setHiddenActionBarMessageId] = useState<number | null>(null);
  const [lightboxImage, setLightboxImage] = useState<ChatLightboxImage | null>(null);
  const [attachedImage, setAttachedImage] = useState<AttachedChatImage | null>(null);
  const [pendingImageUpload, setPendingImageUpload] = useState(false);
  const [pendingSend, setPendingSend] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const [hasInitializedUnreadState, setHasInitializedUnreadState] = useState(false);
  const [lastSeenMessageId, setLastSeenMessageId] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [virtualViewportHeight, setVirtualViewportHeight] = useState(0);
  const [virtualMeasureVersion, setVirtualMeasureVersion] = useState(0);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatImageInputRef = useRef<HTMLInputElement | null>(null);
  const composerResizeFrameRef = useRef<number | null>(null);
  const viewportSettleTimeoutRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const latestMessageIdRef = useRef(0);
  const realtimeConnectedRef = useRef(false);
  const incrementalSyncInFlightRef = useRef(false);
  const incrementalSyncQueuedRef = useRef(false);
  const reactionSyncInFlightRef = useRef(false);
  const reactionSyncQueuedRef = useRef(false);
  const reactionMessageSyncInFlightRef = useRef(false);
  const reactionMessageSyncQueueRef = useRef<Set<number>>(new Set());
  const messagesRef = useRef<GlobalChatMessage[]>([]);
  const messageDayMetaByIdRef = useRef<Map<number, MessageDayMetaCacheEntry>>(new Map());
  const messageRenderSignatureByIdRef = useRef<Map<number, MessageRenderSignatureCacheEntry>>(new Map());
  const pendingReactionByKeyRef = useRef<Record<string, boolean>>({});
  const optimisticReactionRollbackByKeyRef = useRef<Record<string, GlobalChatReaction["users"] | null>>({});
  const actionBarHideTimeoutRef = useRef<number | null>(null);
  const wakeSyncTimeoutRef = useRef<number | null>(null);
  const lastRealtimeStatusRef = useRef<string | null>(null);
  const composerIdempotencyKeyRef = useRef<string | null>(null);
  const composerIdempotencyMessageRef = useRef<string>("");
  const clientMetricsRef = useRef({
    realtimeDisconnects: 0,
    fallbackSyncs: 0,
    duplicateDrops: 0,
  });
  const metricsFlushInFlightRef = useRef(false);
  const incrementalTrueUpTimeoutRef = useRef<number | null>(null);
  const scrollSyncFrameRef = useRef<number | null>(null);
  const blockMeasuredHeightsRef = useRef<Record<string, number>>({});
  const chatRenderProfileRef = useRef<ChatRenderProfileStats>({
    mounts: 0,
    updates: 0,
    commits: 0,
    commitDurationTotalMs: 0,
    commitDurationMaxMs: 0,
    commitsOverBudget: 0,
    actionBarTransitions: 0,
    actionBarTransitionTotalMs: 0,
    actionBarTransitionMaxMs: 0,
    actionBarTransitionsOverBudget: 0,
  });
  const pendingActionBarProfileRef = useRef<{
    targetMessageId: number | null;
    startedAt: number;
  } | null>(null);
  const isPanelOpen = isEmbedded ? true : (isOpenProp ?? uncontrolledIsOpen);
  const sortedMessages = chatStore.messages;
  const hasOlderMessages = chatStore.hasOlderMessages;
  const oldestCursorId = chatStore.oldestCursorId;
  const latestPersistedMessageId = useMemo(() => {
    for (let index = sortedMessages.length - 1; index >= 0; index -= 1) {
      const messageId = toMessageId(sortedMessages[index]?.id ?? 0);
      if (messageId > 0) {
        return messageId;
      }
    }
    return 0;
  }, [sortedMessages]);
  const currentUserReactionLabel = useMemo(() => {
    for (let index = sortedMessages.length - 1; index >= 0; index -= 1) {
      const entry = sortedMessages[index];
      if (entry.userId === currentUserId) {
        return formatOptimisticReactionLabel(entry.senderLabel);
      }
    }
    return "You";
  }, [currentUserId, sortedMessages]);
  const getMessageDayMeta = useCallback((entry: GlobalChatMessage, todayKey: string): MessageDayMetaCacheEntry => {
    const messageId = toMessageId(entry.id);
    const cachedMeta = messageDayMetaByIdRef.current.get(messageId);
    if (
      cachedMeta &&
      cachedMeta.createdAt === entry.createdAt &&
      cachedMeta.todayKey === todayKey
    ) {
      return cachedMeta;
    }

    const nextMeta: MessageDayMetaCacheEntry = {
      createdAt: entry.createdAt,
      todayKey,
      dayKey: formatDayKey(entry.createdAt),
      dayLabel: formatDayLabel(entry.createdAt),
    };
    messageDayMetaByIdRef.current.set(messageId, nextMeta);
    return nextMeta;
  }, []);
  const getMessageRenderSignature = useCallback((entry: GlobalChatMessage): string => {
    const messageId = toMessageId(entry.id);
    const cachedSignature = messageRenderSignatureByIdRef.current.get(messageId);
    if (
      cachedSignature &&
      cachedSignature.createdAt === entry.createdAt &&
      cachedSignature.message === entry.message &&
      cachedSignature.imageUrl === entry.imageUrl &&
      cachedSignature.reactionsRef === entry.reactions
    ) {
      return cachedSignature.signature;
    }

    const signature = `${messageId}:${entry.createdAt}:${entry.message}:${entry.imageUrl ?? ""}:${reactionSignature(entry.reactions)}`;
    messageRenderSignatureByIdRef.current.set(messageId, {
      createdAt: entry.createdAt,
      message: entry.message,
      imageUrl: entry.imageUrl,
      reactionsRef: entry.reactions,
      signature,
    });
    return signature;
  }, []);
  const messageInputMaxLength = useMemo(
    () => maxComposerLengthForReply(replyContext),
    [replyContext],
  );
  const updateChatMessages = useCallback(
    (updater: (currentMessages: GlobalChatMessage[]) => GlobalChatMessage[]) => {
      dispatchChatStore({
        type: "updateMessages",
        updater,
      });
    },
    [],
  );
  const replaceChatSnapshot = useCallback(({
    messages,
    hasOlderMessages: nextHasOlderMessages,
    oldestCursorId: nextOldestCursorId,
  }: {
    messages: GlobalChatMessage[];
    hasOlderMessages: boolean;
    oldestCursorId: number | null;
  }) => {
    dispatchChatStore({
      type: "replace",
      messages,
      hasOlderMessages: nextHasOlderMessages,
      oldestCursorId: nextOldestCursorId,
    });
  }, []);
  const setChatPaging = useCallback(({
    hasOlderMessages: nextHasOlderMessages,
    oldestCursorId: nextOldestCursorId,
  }: {
    hasOlderMessages: boolean;
    oldestCursorId: number | null;
  }) => {
    dispatchChatStore({
      type: "setPaging",
      hasOlderMessages: nextHasOlderMessages,
      oldestCursorId: nextOldestCursorId,
    });
  }, []);
  const groupedMessages = useMemo<ChatMessageGroup[]>(() => {
    const groups: Array<{
      userId: string;
      senderLabel: string;
      senderAvatarUrl: string | null;
      senderAvatarBorderColor: string | null;
      dayKey: string;
      dayLabel: string;
      isCurrentUser: boolean;
      messages: GlobalChatMessage[];
    }> = [];
    const activeMessageIds = new Set<number>();
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

    for (const entry of sortedMessages) {
      const messageId = toMessageId(entry.id);
      activeMessageIds.add(messageId);
      const dayMeta = getMessageDayMeta(entry, todayKey);
      const previous = groups[groups.length - 1];
      if (previous && previous.userId === entry.userId && previous.dayKey === dayMeta.dayKey) {
        previous.messages.push(entry);
        continue;
      }

      groups.push({
        userId: entry.userId,
        senderLabel: entry.senderLabel,
        senderAvatarUrl: entry.senderAvatarUrl,
        senderAvatarBorderColor: entry.senderAvatarBorderColor,
        dayKey: dayMeta.dayKey,
        dayLabel: dayMeta.dayLabel,
        isCurrentUser: entry.userId === currentUserId,
        messages: [entry],
      });
    }

    const dayMetaCache = messageDayMetaByIdRef.current;
    for (const cachedMessageId of dayMetaCache.keys()) {
      if (!activeMessageIds.has(cachedMessageId)) {
        dayMetaCache.delete(cachedMessageId);
      }
    }
    const renderSignatureCache = messageRenderSignatureByIdRef.current;
    for (const cachedMessageId of renderSignatureCache.keys()) {
      if (!activeMessageIds.has(cachedMessageId)) {
        renderSignatureCache.delete(cachedMessageId);
      }
    }

    return groups.map((group, index) => {
      const messageIds = group.messages.map((entry) => toMessageId(entry.id));
      const firstMessageId = messageIds[0] ?? 0;
      const lastMessageId = messageIds[messageIds.length - 1] ?? 0;
      const renderSignature = group.messages
        .map(getMessageRenderSignature)
        .join("|");
      const previousGroupDayKey = groups[index - 1]?.dayKey ?? null;

      return {
        ...group,
        groupKey: `${group.userId}-${group.dayKey}-${firstMessageId}-${lastMessageId}`,
        renderSignature,
        messageIds,
        estimatedHeight: estimateGroupHeightForVirtualization({
          group,
          isEmbedded,
          showDaySeparator: previousGroupDayKey !== group.dayKey,
        }),
      };
    });
  }, [currentUserId, getMessageDayMeta, getMessageRenderSignature, isEmbedded, sortedMessages]);

  const syncComposerHeight = useCallback((target: HTMLTextAreaElement) => {
    const minHeightPx = isEmbedded ? 30 : CHAT_COMPOSER_MIN_HEIGHT_PX;
    const maxHeightPx = isEmbedded ? 72 : CHAT_COMPOSER_MAX_HEIGHT_PX;
    target.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(target.scrollHeight, minHeightPx),
      maxHeightPx,
    );
    target.style.height = `${nextHeight}px`;
    target.style.overflowY = target.scrollHeight > maxHeightPx ? "auto" : "hidden";
  }, [isEmbedded]);

  const focusChatInput = useCallback(() => {
    const input = chatInputRef.current;
    if (!input) {
      return;
    }
    try {
      input.focus({ preventScroll: true });
    } catch {
      input.focus();
    }
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
    syncComposerHeight(input);
  }, [syncComposerHeight]);

  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const scroller = messageListRef.current;
    if (!scroller) {
      return;
    }
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior,
    });
    shouldStickToBottomRef.current = true;
    setShowJumpToLatest(false);
  }, []);

  const queueComposerHeightSync = useCallback(
    (target: HTMLTextAreaElement) => {
      if (composerResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(composerResizeFrameRef.current);
      }
      composerResizeFrameRef.current = window.requestAnimationFrame(() => {
        composerResizeFrameRef.current = null;
        syncComposerHeight(target);
      });
    },
    [syncComposerHeight],
  );

  const getChatRenderProfileSnapshot = useCallback(() => {
    const stats = chatRenderProfileRef.current;
    return {
      actionBarTransitionAvgMs: stats.actionBarTransitions > 0
        ? stats.actionBarTransitionTotalMs / stats.actionBarTransitions
        : 0,
      actionBarTransitionMaxMs: stats.actionBarTransitionMaxMs,
      actionBarTransitions: stats.actionBarTransitions,
      actionBarTransitionsOver50Ms: stats.actionBarTransitionsOverBudget,
      commitAvgMs: stats.commits > 0 ? stats.commitDurationTotalMs / stats.commits : 0,
      commitMaxMs: stats.commitDurationMaxMs,
      commits: stats.commits,
      commitsOver16Ms: stats.commitsOverBudget,
      mounts: stats.mounts,
      updates: stats.updates,
    };
  }, []);

  const onChatProfilerRender = useCallback<ProfilerOnRenderCallback>((_id, phase, actualDuration) => {
    if (!CHAT_PROFILE_ENABLED) {
      return;
    }

    const nextDuration = Number.isFinite(actualDuration) ? Math.max(0, actualDuration) : 0;
    const stats = chatRenderProfileRef.current;
    stats.commits += 1;
    stats.commitDurationTotalMs += nextDuration;
    stats.commitDurationMaxMs = Math.max(stats.commitDurationMaxMs, nextDuration);
    if (nextDuration >= CHAT_PROFILE_COMMIT_BUDGET_MS) {
      stats.commitsOverBudget += 1;
    }
    if (phase === "mount") {
      stats.mounts += 1;
      return;
    }
    stats.updates += 1;
  }, []);

  const startActionBarTransitionProfile = useCallback((targetMessageId: number | null) => {
    if (!CHAT_PROFILE_ENABLED) {
      return;
    }
    pendingActionBarProfileRef.current = {
      targetMessageId,
      startedAt: performance.now(),
    };
  }, []);

  const cancelActionBarHide = useCallback(() => {
    if (actionBarHideTimeoutRef.current !== null) {
      window.clearTimeout(actionBarHideTimeoutRef.current);
      actionBarHideTimeoutRef.current = null;
    }
  }, []);

  const showActionBarForMessage = useCallback((messageId: number) => {
    cancelActionBarHide();
    setHoveredActionBarMessageId((current) => {
      if (current !== messageId) {
        startActionBarTransitionProfile(messageId);
      }
      return messageId;
    });
    setHiddenActionBarMessageId((current) => (
      current !== null && current !== messageId ? null : current
    ));
  }, [cancelActionBarHide, startActionBarTransitionProfile]);

  const queueHideActionBarForMessage = useCallback((messageId: number) => {
    cancelActionBarHide();
    actionBarHideTimeoutRef.current = window.setTimeout(() => {
      actionBarHideTimeoutRef.current = null;
      setHoveredActionBarMessageId((current) => {
        if (current !== messageId) {
          return current;
        }
        startActionBarTransitionProfile(null);
        return null;
      });
    }, CHAT_ACTION_BAR_HIDE_DELAY_MS);
  }, [cancelActionBarHide, startActionBarTransitionProfile]);

  useEffect(() => {
    if (!CHAT_PROFILE_ENABLED) {
      return;
    }
    const pendingProfile = pendingActionBarProfileRef.current;
    if (!pendingProfile || pendingProfile.targetMessageId !== hoveredActionBarMessageId) {
      return;
    }

    const elapsedMs = Math.max(0, performance.now() - pendingProfile.startedAt);
    pendingActionBarProfileRef.current = null;

    const stats = chatRenderProfileRef.current;
    stats.actionBarTransitions += 1;
    stats.actionBarTransitionTotalMs += elapsedMs;
    stats.actionBarTransitionMaxMs = Math.max(stats.actionBarTransitionMaxMs, elapsedMs);
    if (elapsedMs >= CHAT_PROFILE_ACTION_BAR_BUDGET_MS) {
      stats.actionBarTransitionsOverBudget += 1;
    }
  }, [hoveredActionBarMessageId]);

  useEffect(() => {
    if (!CHAT_PROFILE_ENABLED) {
      return;
    }

    const chatProfileWindow = window as Window & {
      __chatProfileSnapshot?: () => ReturnType<typeof getChatRenderProfileSnapshot>;
    };
    chatProfileWindow.__chatProfileSnapshot = () => {
      const snapshot = getChatRenderProfileSnapshot();
      console.info("[chat-profile:snapshot]", snapshot);
      return snapshot;
    };

    const intervalId = window.setInterval(() => {
      const snapshot = getChatRenderProfileSnapshot();
      if (snapshot.commits <= 0 && snapshot.actionBarTransitions <= 0) {
        return;
      }
      console.info("[chat-profile:periodic]", snapshot);
    }, CHAT_PROFILE_LOG_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
      if (chatProfileWindow.__chatProfileSnapshot) {
        delete chatProfileWindow.__chatProfileSnapshot;
      }
    };
  }, [getChatRenderProfileSnapshot]);

  const incrementClientMetric = useCallback(
    (name: "realtimeDisconnects" | "fallbackSyncs" | "duplicateDrops", amount = 1) => {
      if (amount <= 0) {
        return;
      }
      clientMetricsRef.current[name] += amount;
    },
    [],
  );

  const flushClientMetrics = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (metricsFlushInFlightRef.current) {
        return;
      }

      const snapshot = clientMetricsRef.current;
      if (
        snapshot.realtimeDisconnects <= 0 &&
        snapshot.fallbackSyncs <= 0 &&
        snapshot.duplicateDrops <= 0
      ) {
        return;
      }

      metricsFlushInFlightRef.current = true;
      clientMetricsRef.current = {
        realtimeDisconnects: 0,
        fallbackSyncs: 0,
        duplicateDrops: 0,
      };

      try {
        const response = await fetch("/api/chat/metrics", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(snapshot),
          keepalive: force,
        });
        if (!response.ok) {
          throw new Error("Unable to record chat metrics.");
        }
      } catch {
        clientMetricsRef.current.realtimeDisconnects += snapshot.realtimeDisconnects;
        clientMetricsRef.current.fallbackSyncs += snapshot.fallbackSyncs;
        clientMetricsRef.current.duplicateDrops += snapshot.duplicateDrops;
      } finally {
        metricsFlushInFlightRef.current = false;
      }
    },
    [],
  );

  const loadMessages = useCallback(
    async ({
      mode = "replace",
      limit,
      beforeId,
    }: {
      mode?: "replace" | "incremental" | "older";
      limit?: number;
      beforeId?: number;
    } = {}) => {
      const params = new URLSearchParams();
      const afterId = mode === "incremental" ? latestMessageIdRef.current : 0;
      if (afterId > 0) {
        params.set("afterId", `${afterId}`);
      }
      if (mode === "older" && beforeId && beforeId > 0) {
        params.set("beforeId", `${beforeId}`);
      }
      if (limit && limit > 0) {
        params.set("limit", `${limit}`);
      }

      const query = params.toString();
      const response = await fetch(query ? `/api/chat?${query}` : "/api/chat", {
        cache: "no-store",
      });
      const payload = (await response.json()) as GlobalChatResponse;
      if (!response.ok || !payload.messages) {
        throw new Error(payload.error ?? "Unable to load chat.");
      }
      const fetchedMessages = payload.messages.map(withNormalizedMessageReactions);

      if (mode === "replace") {
        const nextMessages = fetchedMessages;
        const nextOldestCursorId = payload.nextBeforeId
          ?? (() => {
            const firstMessageId = toMessageId(nextMessages[0]?.id ?? 0);
            return firstMessageId > 0 ? firstMessageId : null;
          })();
        replaceChatSnapshot({
          messages: nextMessages,
          hasOlderMessages: payload.hasMore === true,
          oldestCursorId: nextOldestCursorId,
        });
        latestMessageIdRef.current = toMessageId(nextMessages[nextMessages.length - 1]?.id ?? 0);
        return;
      }

      if (mode === "incremental") {
        updateChatMessages((currentMessages) => {
          const mergeResult = mergeIncomingMessages(currentMessages, fetchedMessages);
          latestMessageIdRef.current = toMessageId(mergeResult.messages[mergeResult.messages.length - 1]?.id ?? 0);
          if (mergeResult.droppedCount > 0) {
            incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
          }
          return mergeResult.messages;
        });
        return;
      }

      if (mode === "older") {
        updateChatMessages((currentMessages) => {
          const mergeResult = prependOlderMessages(currentMessages, fetchedMessages);
          if (mergeResult.droppedCount > 0) {
            incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
          }
          return mergeResult.messages;
        });
        setChatPaging({
          hasOlderMessages: payload.hasMore === true,
          oldestCursorId: payload.nextBeforeId ?? null,
        });
      }
    },
    [incrementClientMetric, replaceChatSnapshot, setChatPaging, updateChatMessages],
  );

  const queueIncrementalSync = useCallback(() => {
    if (incrementalTrueUpTimeoutRef.current !== null) {
      window.clearTimeout(incrementalTrueUpTimeoutRef.current);
      incrementalTrueUpTimeoutRef.current = null;
    }
    incrementalSyncQueuedRef.current = true;
    if (!isBrowserOnline()) {
      return;
    }
    if (incrementalSyncInFlightRef.current) {
      return;
    }

    incrementalSyncInFlightRef.current = true;
    void (async () => {
      try {
        while (incrementalSyncQueuedRef.current) {
          if (!isBrowserOnline()) {
            break;
          }
          incrementalSyncQueuedRef.current = false;
          try {
            await loadMessages({
              mode: "incremental",
              limit: CHAT_INCREMENTAL_FETCH_LIMIT,
            });
          } catch {
            // Background sync errors are non-fatal; the next sync attempt recovers.
          }
        }
      } finally {
        incrementalSyncInFlightRef.current = false;
      }
    })();
  }, [loadMessages]);

  const scheduleIncrementalTrueUp = useCallback(() => {
    if (incrementalTrueUpTimeoutRef.current !== null) {
      window.clearTimeout(incrementalTrueUpTimeoutRef.current);
    }
    incrementalTrueUpTimeoutRef.current = window.setTimeout(() => {
      incrementalTrueUpTimeoutRef.current = null;
      queueIncrementalSync();
    }, CHAT_INCREMENTAL_TRUE_UP_DEBOUNCE_MS);
  }, [queueIncrementalSync]);

  useEffect(() => {
    messagesRef.current = sortedMessages;
  }, [sortedMessages]);

  useEffect(() => {
    pendingReactionByKeyRef.current = pendingReactionByKey;
  }, [pendingReactionByKey]);

  const applyReactionsToMessage = useCallback(
    (messageId: number, reactions: GlobalChatReaction[] | null | undefined) => {
      const normalizedMessageId = Math.max(1, Math.floor(messageId));
      if (!normalizedMessageId) {
        return;
      }

      const normalizedReactions = normalizeMessageReactions(reactions);
      const nextReactionSignature = reactionSignature(normalizedReactions);
      updateChatMessages((currentMessages) => {
        const targetIndex = currentMessages.findIndex(
          (entry) => toMessageId(entry.id) === normalizedMessageId,
        );
        if (targetIndex < 0) {
          return currentMessages;
        }
        const targetMessage = currentMessages[targetIndex];
        if (reactionSignature(targetMessage.reactions) === nextReactionSignature) {
          return currentMessages;
        }

        const nextMessages = [...currentMessages];
        nextMessages[targetIndex] = {
          ...targetMessage,
          reactions: normalizedReactions,
        };
        return nextMessages;
      });
    },
    [updateChatMessages],
  );

  const applyReactionUsersToMessageEmoji = useCallback(
    ({
      messageId,
      emoji,
      users,
    }: {
      messageId: number;
      emoji: string;
      users: GlobalChatReaction["users"] | null;
    }) => {
      const normalizedMessageId = Math.max(1, Math.floor(messageId));
      const normalizedEmoji = emoji.trim();
      if (!normalizedMessageId || !normalizedEmoji) {
        return;
      }

      updateChatMessages((currentMessages) => {
        const targetIndex = currentMessages.findIndex(
          (entry) => toMessageId(entry.id) === normalizedMessageId,
        );
        if (targetIndex < 0) {
          return currentMessages;
        }

        const targetMessage = currentMessages[targetIndex];
        const nextReactions = upsertReactionUsersForEmoji({
          reactions: targetMessage.reactions,
          emoji: normalizedEmoji,
          users,
        });
        const currentReactionSignature = reactionSignature(targetMessage.reactions);
        const nextReactionSignature = reactionSignature(nextReactions);
        if (currentReactionSignature === nextReactionSignature) {
          return currentMessages;
        }

        const nextMessages = [...currentMessages];
        nextMessages[targetIndex] = {
          ...targetMessage,
          reactions: nextReactions,
        };
        return nextMessages;
      });
    },
    [updateChatMessages],
  );

  const refreshKnownMessageReactions = useCallback(async () => {
    const knownMessages = messagesRef.current;
    if (knownMessages.length === 0) {
      return;
    }

    const limit = Math.min(
      Math.max(knownMessages.length, CHAT_INCREMENTAL_FETCH_LIMIT),
      MAX_GLOBAL_CHAT_FETCH_LIMIT,
    );
    const params = new URLSearchParams({
      limit: `${limit}`,
    });
    const response = await fetch(`/api/chat?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as GlobalChatResponse;
    if (!response.ok || !payload.messages) {
      throw new Error(payload.error ?? "Unable to refresh chat reactions.");
    }

    const reactionsByMessageId = new Map<number, GlobalChatReaction[]>();
    const signaturesByMessageId = new Map<number, string>();
    for (const entry of payload.messages) {
      const messageId = toMessageId(entry.id);
      if (!messageId) {
        continue;
      }
      const normalizedReactions = normalizeMessageReactions(entry.reactions);
      reactionsByMessageId.set(messageId, normalizedReactions);
      signaturesByMessageId.set(messageId, reactionSignature(normalizedReactions));
    }
    if (reactionsByMessageId.size === 0) {
      return;
    }

    updateChatMessages((currentMessages) => {
      let nextMessages: GlobalChatMessage[] | null = null;
      for (let index = 0; index < currentMessages.length; index += 1) {
        const entry = currentMessages[index];
        const messageId = toMessageId(entry.id);
        const nextReactions = reactionsByMessageId.get(messageId);
        if (!nextReactions) {
          continue;
        }
        if (reactionSignature(entry.reactions) === signaturesByMessageId.get(messageId)) {
          continue;
        }
        if (!nextMessages) {
          nextMessages = [...currentMessages];
        }
        nextMessages[index] = {
          ...entry,
          reactions: nextReactions,
        };
      }
      return nextMessages ?? currentMessages;
    });
  }, [updateChatMessages]);

  const queueReactionSync = useCallback(() => {
    reactionSyncQueuedRef.current = true;
    if (!isBrowserOnline()) {
      return;
    }
    if (reactionSyncInFlightRef.current) {
      return;
    }

    reactionSyncInFlightRef.current = true;
    void (async () => {
      try {
        while (reactionSyncQueuedRef.current) {
          if (!isBrowserOnline()) {
            break;
          }
          reactionSyncQueuedRef.current = false;
          try {
            await refreshKnownMessageReactions();
          } catch {
            // Background sync errors are non-fatal; the next sync attempt recovers.
          }
        }
      } finally {
        reactionSyncInFlightRef.current = false;
      }
    })();
  }, [refreshKnownMessageReactions]);

  const syncReactionForMessage = useCallback(async (messageId: number) => {
    const normalizedMessageId = Math.max(1, Math.floor(messageId));
    if (!normalizedMessageId) {
      return;
    }

    const params = new URLSearchParams({
      messageId: `${normalizedMessageId}`,
    });
    const response = await fetch(`/api/chat/reactions?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as GlobalChatToggleReactionResponse;
    if (!response.ok || !payload.messageId || !Array.isArray(payload.reactions)) {
      throw new Error(payload.error ?? "Unable to refresh reactions.");
    }
    applyReactionsToMessage(payload.messageId, payload.reactions);
  }, [applyReactionsToMessage]);

  const queueReactionSyncForMessage = useCallback((messageId: number) => {
    const normalizedMessageId = Math.max(1, Math.floor(messageId));
    if (!normalizedMessageId) {
      return;
    }

    reactionMessageSyncQueueRef.current.add(normalizedMessageId);
    if (!isBrowserOnline()) {
      return;
    }
    if (reactionMessageSyncInFlightRef.current) {
      return;
    }

    reactionMessageSyncInFlightRef.current = true;
    void (async () => {
      try {
        while (reactionMessageSyncQueueRef.current.size > 0) {
          if (!isBrowserOnline()) {
            break;
          }
          const messageIds = [...reactionMessageSyncQueueRef.current];
          reactionMessageSyncQueueRef.current.clear();
          try {
            await Promise.all(messageIds.map((entry) => syncReactionForMessage(entry)));
          } catch {
            queueReactionSync();
          }
        }
      } finally {
        reactionMessageSyncInFlightRef.current = false;
      }
    })();
  }, [queueReactionSync, syncReactionForMessage]);

  const scheduleWakeSync = useCallback(() => {
    if (wakeSyncTimeoutRef.current !== null) {
      window.clearTimeout(wakeSyncTimeoutRef.current);
    }
    wakeSyncTimeoutRef.current = window.setTimeout(() => {
      wakeSyncTimeoutRef.current = null;
      queueIncrementalSync();
      queueReactionSync();
    }, CHAT_WAKE_SYNC_DEBOUNCE_MS);
  }, [queueIncrementalSync, queueReactionSync]);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        await loadMessages({
          limit: CHAT_INITIAL_FETCH_LIMIT,
        });
      } catch (loadError) {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load chat.");
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      canceled = true;
    };
  }, [loadMessages]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("global-chat")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "fantasy_global_chat_messages",
        },
        (payload) => {
          const realtimeMessage = toRealtimeMessagePayload(asRecord(payload)?.new);
          if (realtimeMessage) {
            updateChatMessages((currentMessages) => {
              const mergeResult = mergeIncomingMessages(currentMessages, [realtimeMessage]);
              latestMessageIdRef.current = toMessageId(mergeResult.messages[mergeResult.messages.length - 1]?.id ?? 0);
              if (mergeResult.droppedCount > 0) {
                incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
              }
              return mergeResult.messages;
            });
            scheduleIncrementalTrueUp();
            return;
          }
          queueIncrementalSync();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fantasy_global_chat_reactions",
        },
        (payload) => {
          const messageId = messageIdFromReactionRealtimePayload(payload);
          if (messageId > 0) {
            queueReactionSyncForMessage(messageId);
            return;
          }
          queueReactionSync();
        },
      )
      .subscribe((status) => {
        const previousStatus = lastRealtimeStatusRef.current;
        lastRealtimeStatusRef.current = status;
        if (status === "SUBSCRIBED") {
          realtimeConnectedRef.current = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          if (previousStatus === "SUBSCRIBED") {
            incrementClientMetric("realtimeDisconnects");
          }
          realtimeConnectedRef.current = false;
        }
      });

    return () => {
      realtimeConnectedRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [
    incrementClientMetric,
    queueIncrementalSync,
    queueReactionSync,
    queueReactionSyncForMessage,
    scheduleIncrementalTrueUp,
    updateChatMessages,
  ]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (realtimeConnectedRef.current) {
        return;
      }
      incrementClientMetric("fallbackSyncs");
      queueIncrementalSync();
      queueReactionSync();
      reactionMessageSyncQueueRef.current.clear();
    }, CHAT_FALLBACK_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [incrementClientMetric, queueIncrementalSync, queueReactionSync]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleWakeSync();
      }
    };
    const onFocus = () => {
      scheduleWakeSync();
    };
    const onOnline = () => {
      scheduleWakeSync();
    };
    const onPageShow = () => {
      scheduleWakeSync();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pageshow", onPageShow);
      if (wakeSyncTimeoutRef.current !== null) {
        window.clearTimeout(wakeSyncTimeoutRef.current);
        wakeSyncTimeoutRef.current = null;
      }
    };
  }, [scheduleWakeSync]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void flushClientMetrics();
    }, CHAT_METRICS_FLUSH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushClientMetrics({ force: true });
      }
    };
    const onPageHide = () => {
      void flushClientMetrics({ force: true });
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      void flushClientMetrics({ force: true });
    };
  }, [flushClientMetrics]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)");
    const syncViewport = () => {
      setIsMobileViewport(media.matches);
    };

    syncViewport();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncViewport);
      return () => {
        media.removeEventListener("change", syncViewport);
      };
    }

    media.addListener(syncViewport);
    return () => {
      media.removeListener(syncViewport);
    };
  }, []);

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }

    shouldStickToBottomRef.current = true;
    window.requestAnimationFrame(() => {
      scrollMessagesToBottom();
    });
  }, [isPanelOpen, scrollMessagesToBottom]);

  useEffect(() => {
    if (!isPanelOpen || !shouldStickToBottomRef.current) {
      return;
    }

    scrollMessagesToBottom();
  }, [isPanelOpen, scrollMessagesToBottom, sortedMessages]);

  useEffect(() => {
    if (!isPanelOpen || shouldStickToBottomRef.current || sortedMessages.length === 0) {
      return;
    }
    const latestMessage = sortedMessages[sortedMessages.length - 1];
    if (latestMessage?.userId !== currentUserId) {
      setShowJumpToLatest(true);
    }
  }, [currentUserId, isPanelOpen, sortedMessages]);

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }

    const input = chatInputRef.current;
    if (!input) {
      return;
    }
    queueComposerHeightSync(input);
  }, [isPanelOpen, queueComposerHeightSync]);

  useEffect(() => {
    return () => {
      if (scrollSyncFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollSyncFrameRef.current);
        scrollSyncFrameRef.current = null;
      }
      if (incrementalTrueUpTimeoutRef.current !== null) {
        window.clearTimeout(incrementalTrueUpTimeoutRef.current);
        incrementalTrueUpTimeoutRef.current = null;
      }
      if (actionBarHideTimeoutRef.current !== null) {
        window.clearTimeout(actionBarHideTimeoutRef.current);
        actionBarHideTimeoutRef.current = null;
      }
      if (composerResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(composerResizeFrameRef.current);
        composerResizeFrameRef.current = null;
      }
      if (viewportSettleTimeoutRef.current !== null) {
        window.clearTimeout(viewportSettleTimeoutRef.current);
        viewportSettleTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }

    const scroller = messageListRef.current;
    const content = messageContentRef.current;
    if (!scroller || !content || typeof ResizeObserver === "undefined") {
      return;
    }

    let frame: number | null = null;
    const pinIfNeeded = () => {
      if (!shouldStickToBottomRef.current) {
        return;
      }
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        scrollMessagesToBottom();
      });
    };

    const observer = new ResizeObserver(() => {
      pinIfNeeded();
    });

    observer.observe(content);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [isPanelOpen, scrollMessagesToBottom]);

  useEffect(() => {
    if (!isMobileViewport) {
      document.documentElement.style.removeProperty("--chat-vvh");
      return;
    }

    const root = document.documentElement;
    const visualViewport = window.visualViewport;

    const applyViewportHeight = () => {
      const nextHeight = visualViewport?.height ?? window.innerHeight;
      root.style.setProperty("--chat-vvh", `${Math.round(nextHeight)}px`);
    };

    const settleAfterViewportShift = () => {
      applyViewportHeight();
      if (!isPanelOpen || !shouldStickToBottomRef.current) {
        return;
      }
      window.requestAnimationFrame(() => {
        scrollMessagesToBottom();
      });
      if (viewportSettleTimeoutRef.current !== null) {
        window.clearTimeout(viewportSettleTimeoutRef.current);
      }
      viewportSettleTimeoutRef.current = window.setTimeout(() => {
        scrollMessagesToBottom();
        viewportSettleTimeoutRef.current = null;
      }, 90);
    };

    settleAfterViewportShift();
    visualViewport?.addEventListener("resize", settleAfterViewportShift);
    visualViewport?.addEventListener("scroll", settleAfterViewportShift);
    window.addEventListener("resize", settleAfterViewportShift);
    window.addEventListener("orientationchange", settleAfterViewportShift);

    return () => {
      visualViewport?.removeEventListener("resize", settleAfterViewportShift);
      visualViewport?.removeEventListener("scroll", settleAfterViewportShift);
      window.removeEventListener("resize", settleAfterViewportShift);
      window.removeEventListener("orientationchange", settleAfterViewportShift);
      if (viewportSettleTimeoutRef.current !== null) {
        window.clearTimeout(viewportSettleTimeoutRef.current);
        viewportSettleTimeoutRef.current = null;
      }
      root.style.removeProperty("--chat-vvh");
    };
  }, [isMobileViewport, isPanelOpen, scrollMessagesToBottom]);

  useEffect(() => {
    if (!isPanelOpen || !isMobileViewport) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;

    const previous = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      htmlOverscrollBehaviorY: html.style.overscrollBehaviorY,
      bodyOverflow: body.style.overflow,
      bodyOverscrollBehaviorY: body.style.overscrollBehaviorY,
    };

    html.style.overflow = "hidden";
    html.style.height = "100%";
    html.style.overscrollBehaviorY = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehaviorY = "none";

    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.height = previous.htmlHeight;
      html.style.overscrollBehaviorY = previous.htmlOverscrollBehaviorY;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehaviorY = previous.bodyOverscrollBehaviorY;
    };
  }, [isPanelOpen, isMobileViewport]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasOlderMessages || !oldestCursorId) {
      return;
    }

    const scroller = messageListRef.current;
    const previousScrollHeight = scroller?.scrollHeight ?? 0;
    const previousScrollTop = scroller?.scrollTop ?? 0;

    setLoadingOlder(true);
    setError(null);
    try {
      await loadMessages({
        mode: "older",
        beforeId: oldestCursorId,
        limit: CHAT_PAGE_FETCH_LIMIT,
      });
      window.requestAnimationFrame(() => {
        const currentScroller = messageListRef.current;
        if (!currentScroller) {
          return;
        }
        const nextScrollHeight = currentScroller.scrollHeight;
        const delta = nextScrollHeight - previousScrollHeight;
        currentScroller.scrollTop = previousScrollTop + Math.max(delta, 0);
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlderMessages, loadMessages, loadingOlder, oldestCursorId]);

  const clearComposerIdempotency = useCallback(() => {
    composerIdempotencyKeyRef.current = null;
    composerIdempotencyMessageRef.current = "";
  }, []);

  useEffect(() => {
    if (messageInput.length <= messageInputMaxLength) {
      return;
    }
    setMessageInput((current) => current.slice(0, messageInputMaxLength));
    const input = chatInputRef.current;
    if (!input) {
      return;
    }
    window.requestAnimationFrame(() => {
      syncComposerHeight(input);
    });
  }, [messageInput, messageInputMaxLength, syncComposerHeight]);

  useEffect(() => {
    clearComposerIdempotency();
  }, [clearComposerIdempotency, replyContext]);

  const openChatImagePicker = useCallback(() => {
    if (pendingImageUpload || pendingSend) {
      return;
    }
    chatImageInputRef.current?.click();
  }, [pendingImageUpload, pendingSend]);

  const removeAttachedImage = useCallback(() => {
    setAttachedImage(null);
    clearComposerIdempotency();
    if (chatImageInputRef.current) {
      chatImageInputRef.current.value = "";
    }
  }, [clearComposerIdempotency]);

  const attachImageFile = useCallback(
    async (sourceFile: File) => {
      const baseValidationError = validateChatImageFileBase(sourceFile);
      if (baseValidationError) {
        setError(baseValidationError);
        return;
      }

      setError(null);
      setPendingImageUpload(true);
      try {
        const uploadFile = await optimizeChatImageFileForUpload(sourceFile);
        const validationError = validateChatImageFile(uploadFile);
        if (validationError) {
          throw new Error(validationError);
        }

        const formData = new FormData();
        formData.append("file", uploadFile);
        const response = await fetch("/api/chat/upload", {
          method: "POST",
          body: formData,
        });
        const payload = (await response.json()) as GlobalChatUploadResponse;
        if (!response.ok || !payload.imageUrl || !payload.path) {
          throw new Error(payload.error ?? "Unable to upload chat image.");
        }
        setAttachedImage({
          imageUrl: payload.imageUrl,
          path: payload.path,
          fileName: uploadFile.name,
        });
        clearComposerIdempotency();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Unable to upload chat image.");
      } finally {
        setPendingImageUpload(false);
      }
    },
    [clearComposerIdempotency],
  );

  const attachImageUrl = useCallback(
    (imageUrl: string) => {
      const normalizedImageUrl = normalizeChatImageUrl(imageUrl);
      if (!normalizedImageUrl) {
        setError("Invalid image URL.");
        return;
      }

      setError(null);
      setAttachedImage({
        imageUrl: normalizedImageUrl,
        path: CHAT_EXTERNAL_IMAGE_PATH,
        fileName: getImageFileNameFromUrl(normalizedImageUrl),
      });
      clearComposerIdempotency();
    },
    [clearComposerIdempotency],
  );

  const handleImageInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0] ?? null;
      event.currentTarget.value = "";
      if (!file) {
        return;
      }
      await attachImageFile(file);
    },
    [attachImageFile],
  );

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      if (pendingImageUpload || pendingSend) {
        return;
      }
      const clipboardData = event.clipboardData;
      if (!clipboardData) {
        return;
      }

      const pastedImageFile = extractImageFileFromClipboard(clipboardData);
      if (pastedImageFile) {
        event.preventDefault();
        void attachImageFile(pastedImageFile);
        return;
      }

      const pastedImageUrl = extractImageUrlFromClipboard(clipboardData);
      if (pastedImageUrl) {
        event.preventDefault();
        attachImageUrl(pastedImageUrl);
      }
    },
    [attachImageFile, attachImageUrl, pendingImageUpload, pendingSend],
  );

  const toggleMessageReaction = useCallback(
    async ({
      messageId,
      emoji,
      closeActionBar = false,
    }: {
      messageId: number;
      emoji: string;
      closeActionBar?: boolean;
    }) => {
      const normalizedMessageId = Math.max(1, Math.floor(messageId));
      const normalizedEmoji = emoji.trim();
      if (!normalizedMessageId || !normalizedEmoji) {
        return;
      }

      const key = reactionStateKey(normalizedMessageId, normalizedEmoji);
      if (pendingReactionByKeyRef.current[key]) {
        return;
      }

      const messageSnapshot = messagesRef.current.find(
        (entry) => toMessageId(entry.id) === normalizedMessageId,
      );
      if (!messageSnapshot) {
        return;
      }

      const normalizedReactions = normalizeMessageReactions(messageSnapshot.reactions);
      const matchingReaction = normalizedReactions.find((entry) => entry.emoji === normalizedEmoji);
      const previousUsers = matchingReaction ? [...matchingReaction.users] : null;
      const optimisticUsers = (() => {
        const currentUsers = matchingReaction?.users ?? [];
        const hasCurrentUser = currentUsers.some((entry) => entry.userId === currentUserId);
        if (hasCurrentUser) {
          return currentUsers.filter((entry) => entry.userId !== currentUserId);
        }
        return [
          ...currentUsers,
          {
            userId: currentUserId,
            label: currentUserReactionLabel,
          },
        ];
      })();

      if (closeActionBar) {
        cancelActionBarHide();
        setHiddenActionBarMessageId(normalizedMessageId);
        setHoveredActionBarMessageId(null);
      }

      setPendingReactionByKey((current) => ({
        ...current,
        [key]: true,
      }));
      optimisticReactionRollbackByKeyRef.current[key] = previousUsers;
      applyReactionUsersToMessageEmoji({
        messageId: normalizedMessageId,
        emoji: normalizedEmoji,
        users: optimisticUsers,
      });
      setError(null);
      try {
        const response = await fetch("/api/chat/reactions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            messageId: normalizedMessageId,
            emoji: normalizedEmoji,
          }),
        });
        const payload = (await response.json()) as GlobalChatToggleReactionResponse;
        if (!response.ok || !payload.messageId || !Array.isArray(payload.reactions)) {
          throw new Error(payload.error ?? "Unable to update reaction.");
        }
        applyReactionsToMessage(payload.messageId, payload.reactions);
      } catch (reactionError) {
        if (Object.prototype.hasOwnProperty.call(optimisticReactionRollbackByKeyRef.current, key)) {
          applyReactionUsersToMessageEmoji({
            messageId: normalizedMessageId,
            emoji: normalizedEmoji,
            users: optimisticReactionRollbackByKeyRef.current[key] ?? null,
          });
        }
        queueReactionSync();
        setError(reactionError instanceof Error ? reactionError.message : "Unable to update reaction.");
      } finally {
        delete optimisticReactionRollbackByKeyRef.current[key];
        setPendingReactionByKey((current) => {
          if (!current[key]) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [
      applyReactionUsersToMessageEmoji,
      applyReactionsToMessage,
      cancelActionBarHide,
      currentUserId,
      currentUserReactionLabel,
      queueReactionSync,
    ],
  );

  const handleReplyToMessage = useCallback(
    (entry: GlobalChatMessage) => {
      setReplyContext({
        messageId: toMessageId(entry.id),
        senderLabel: sanitizeReplySenderLabel(entry.senderLabel),
        snippet: replySnippetFromMessage({
          message: entry.message,
          imageUrl: entry.imageUrl,
        }),
      });
      setError(null);
      window.requestAnimationFrame(() => {
        focusChatInput();
      });
    },
    [focusChatInput],
  );

  const handleCopyMessage = useCallback(
    async (entry: GlobalChatMessage) => {
      const parsedMessage = parseMessageWithReplyContext(entry.message);
      const normalizedBody = normalizeChatInlineText(parsedMessage.body);
      const lines: string[] = [];
      if (parsedMessage.replyContext) {
        lines.push(
          `Reply to ${parsedMessage.replyContext.senderLabel}: ${parsedMessage.replyContext.snippet}`,
        );
      }
      if (normalizedBody) {
        lines.push(normalizedBody);
      }
      if (entry.imageUrl) {
        lines.push(entry.imageUrl);
      }
      if (lines.length === 0) {
        return;
      }

      if (!navigator.clipboard?.writeText) {
        setError("Clipboard is unavailable in this browser.");
        return;
      }

      try {
        await navigator.clipboard.writeText(lines.join("\n"));
        setError(null);
      } catch {
        setError("Unable to copy message.");
      }
    },
    [],
  );

  const handleMoreMessageAction = useCallback(
    async (entry: GlobalChatMessage) => {
      if (entry.imageUrl) {
        window.open(entry.imageUrl, "_blank", "noopener,noreferrer");
        return;
      }
      await handleCopyMessage(entry);
    },
    [handleCopyMessage],
  );

  const openImageLightbox = useCallback((entry: GlobalChatMessage) => {
    if (!entry.imageUrl) {
      return;
    }
    setLightboxImage({
      imageUrl: entry.imageUrl,
      senderLabel: sanitizeReplySenderLabel(entry.senderLabel),
      createdAt: entry.createdAt,
    });
  }, []);

  const closeImageLightbox = useCallback(() => {
    setLightboxImage(null);
  }, []);

  const pendingReactionByMessageId = useMemo(() => {
    const next = new Map<number, Set<string>>();
    for (const [key, pending] of Object.entries(pendingReactionByKey)) {
      if (!pending) {
        continue;
      }
      const separatorIndex = key.indexOf(":");
      if (separatorIndex <= 0) {
        continue;
      }
      const messageId = toMessageId(key.slice(0, separatorIndex));
      const emoji = key.slice(separatorIndex + 1).trim();
      if (!messageId || !emoji) {
        continue;
      }
      const existing = next.get(messageId) ?? new Set<string>();
      existing.add(emoji);
      next.set(messageId, existing);
    }
    return next;
  }, [pendingReactionByKey]);
  const pendingReactionSignatureByMessageId = useMemo(() => {
    const next = new Map<number, string>();
    for (const [messageId, pendingSet] of pendingReactionByMessageId.entries()) {
      if (!pendingSet || pendingSet.size === 0) {
        continue;
      }
      const signature = [...pendingSet].sort().join(",");
      if (!signature) {
        continue;
      }
      next.set(messageId, signature);
    }
    return next;
  }, [pendingReactionByMessageId]);
  const groupKeyByMessageId = useMemo(() => {
    const next = new Map<number, string>();
    for (const group of groupedMessages) {
      for (const messageId of group.messageIds) {
        next.set(messageId, group.groupKey);
      }
    }
    return next;
  }, [groupedMessages]);
  const hoveredActionBarGroupKey = useMemo(() => {
    if (hoveredActionBarMessageId === null) {
      return null;
    }
    return groupKeyByMessageId.get(hoveredActionBarMessageId) ?? null;
  }, [groupKeyByMessageId, hoveredActionBarMessageId]);
  const hiddenActionBarGroupKey = useMemo(() => {
    if (hiddenActionBarMessageId === null) {
      return null;
    }
    return groupKeyByMessageId.get(hiddenActionBarMessageId) ?? null;
  }, [groupKeyByMessageId, hiddenActionBarMessageId]);
  const pendingReactionSignatureByGroupKey = useMemo(() => {
    const next = new Map<string, string>();
    for (const group of groupedMessages) {
      let pendingReactionSignature = "";
      for (const messageId of group.messageIds) {
        const pendingSignature = pendingReactionSignatureByMessageId.get(messageId);
        if (!pendingSignature) {
          continue;
        }
        pendingReactionSignature = pendingReactionSignature
          ? `${pendingReactionSignature}|${messageId}:${pendingSignature}`
          : `${messageId}:${pendingSignature}`;
      }
      if (pendingReactionSignature) {
        next.set(group.groupKey, pendingReactionSignature);
      }
    }
    return next;
  }, [groupedMessages, pendingReactionSignatureByMessageId]);

  const renderBlocks = useMemo<ChatRenderBlock[]>(() => {
    const nextBlocks: ChatRenderBlock[] = [];
    if (hasOlderMessages) {
      nextBlocks.push({
        key: "older-messages",
        type: "older",
      });
    }

    if (sortedMessages.length === 0) {
      nextBlocks.push({
        key: "empty-chat",
        type: "empty",
      });
      return nextBlocks;
    }

    for (let index = 0; index < groupedMessages.length; index += 1) {
      const group = groupedMessages[index];
      const previousGroupDayKey = groupedMessages[index - 1]?.dayKey ?? null;
      nextBlocks.push({
        key: `group-${group.groupKey}`,
        type: "group",
        group,
        previousGroupDayKey,
        estimatedHeight: group.estimatedHeight,
      });
    }
    return nextBlocks;
  }, [groupedMessages, hasOlderMessages, sortedMessages.length]);

  const shouldVirtualizeBlocks = (
    CHAT_ENABLE_VIRTUALIZATION &&
    !isMobileViewport &&
    renderBlocks.length >= CHAT_VIRTUALIZATION_MIN_BLOCK_COUNT
  );

  const syncVirtualViewportState = useCallback((scroller: HTMLDivElement) => {
    const nextTop = scroller.scrollTop;
    const nextHeight = scroller.clientHeight;
    setVirtualScrollTop((current) => (
      Math.abs(current - nextTop) < 1 ? current : nextTop
    ));
    setVirtualViewportHeight((current) => (
      current === nextHeight ? current : nextHeight
    ));
  }, []);

  const scheduleVirtualViewportStateSync = useCallback((scroller: HTMLDivElement) => {
    if (!shouldVirtualizeBlocks) {
      return;
    }
    if (scrollSyncFrameRef.current !== null) {
      return;
    }
    scrollSyncFrameRef.current = window.requestAnimationFrame(() => {
      scrollSyncFrameRef.current = null;
      syncVirtualViewportState(scroller);
    });
  }, [shouldVirtualizeBlocks, syncVirtualViewportState]);

  const onMeasuredBlockHeight = useCallback((blockKey: string, nextHeight: number) => {
    const currentHeight = blockMeasuredHeightsRef.current[blockKey];
    if (currentHeight && Math.abs(currentHeight - nextHeight) <= 1) {
      return;
    }
    blockMeasuredHeightsRef.current[blockKey] = nextHeight;
    setVirtualMeasureVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!isPanelOpen) {
      return;
    }
    if (!shouldVirtualizeBlocks) {
      return;
    }
    const scroller = messageListRef.current;
    if (!scroller) {
      return;
    }

    syncVirtualViewportState(scroller);
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(() => {
      syncVirtualViewportState(scroller);
    });
    observer.observe(scroller);
    return () => {
      observer.disconnect();
    };
  }, [isPanelOpen, shouldVirtualizeBlocks, sortedMessages.length, syncVirtualViewportState]);

  useEffect(() => {
    blockMeasuredHeightsRef.current = {};
    setVirtualMeasureVersion((current) => current + 1);
  }, [isEmbedded]);

  const blockLayouts = useMemo<ChatRenderBlockLayout[]>(() => {
    if (!shouldVirtualizeBlocks) {
      return [];
    }
    const measuredVersion = virtualMeasureVersion;
    void measuredVersion;
    let nextTop = 0;
    return renderBlocks.map((block) => {
      const measuredHeight = blockMeasuredHeightsRef.current[block.key];
      const height = measuredHeight ?? estimateBlockHeight({
        block,
        loadingOlder,
      });
      const layout: ChatRenderBlockLayout = {
        ...block,
        bottom: nextTop + height,
        height,
        top: nextTop,
      };
      nextTop += height;
      return layout;
    });
  }, [loadingOlder, renderBlocks, shouldVirtualizeBlocks, virtualMeasureVersion]);

  const totalBlockHeight = shouldVirtualizeBlocks
    ? (blockLayouts[blockLayouts.length - 1]?.bottom ?? 0)
    : 0;

  const visibleBlockLayouts = useMemo(() => {
    if (!shouldVirtualizeBlocks) {
      return [];
    }

    const overscanTop = Math.max(0, virtualScrollTop - CHAT_VIRTUALIZATION_OVERSCAN_PX);
    const overscanBottom = virtualScrollTop + Math.max(virtualViewportHeight, 1) + CHAT_VIRTUALIZATION_OVERSCAN_PX;
    let startIndex = 0;
    while (startIndex < blockLayouts.length && blockLayouts[startIndex].bottom < overscanTop) {
      startIndex += 1;
    }

    let endIndex = startIndex;
    while (endIndex < blockLayouts.length && blockLayouts[endIndex].top <= overscanBottom) {
      endIndex += 1;
    }
    return blockLayouts.slice(
      Math.max(0, startIndex - 1),
      Math.min(blockLayouts.length, endIndex + 1),
    );
  }, [blockLayouts, shouldVirtualizeBlocks, virtualScrollTop, virtualViewportHeight]);

  const renderBlockContent = useCallback((block: ChatRenderBlock) => {
    if (block.type === "older") {
      return (
        <div className="mb-2 flex justify-center">
          <Button
            className="h-11 min-h-11 rounded-full bg-[#11203a]/78 px-3.5 text-xs font-medium text-[#b7c7e3] data-[hover=true]:bg-[#162744] sm:h-8 sm:min-h-8 sm:px-3 sm:text-[11px]"
            isDisabled={loadingOlder}
            size="sm"
            variant="flat"
            onPress={() => {
              void loadOlderMessages();
            }}
          >
            {loadingOlder ? "Loading older..." : "Load older messages"}
          </Button>
        </div>
      );
    }

    if (block.type === "empty") {
      return <p className="text-sm text-slate-300">No messages yet. Start the banter.</p>;
    }

    const groupKey = block.group.groupKey;
    const hoveredForGroup = hoveredActionBarGroupKey === groupKey
      ? hoveredActionBarMessageId
      : null;
    const hiddenForGroup = hiddenActionBarGroupKey === groupKey
      ? hiddenActionBarMessageId
      : null;
    const pendingReactionSignature = pendingReactionSignatureByGroupKey.get(groupKey) ?? "";
    return (
      <ChatMessageGroupBlock
        key={groupKey}
        currentUserId={currentUserId}
        group={block.group}
        handleCopyMessage={handleCopyMessage}
        handleMoreMessageAction={handleMoreMessageAction}
        handleReplyToMessage={handleReplyToMessage}
        hiddenActionBarMessageId={hiddenForGroup}
        hoveredActionBarMessageId={hoveredForGroup}
        isEmbedded={isEmbedded}
        openImageLightbox={openImageLightbox}
        pendingReactionByMessageId={pendingReactionByMessageId}
        pendingReactionSignature={pendingReactionSignature}
        previousGroupDayKey={block.previousGroupDayKey}
        queueHideActionBarForMessage={queueHideActionBarForMessage}
        showActionBarForMessage={showActionBarForMessage}
        toggleMessageReaction={toggleMessageReaction}
      />
    );
  }, [
    currentUserId,
    hiddenActionBarGroupKey,
    hiddenActionBarMessageId,
    handleCopyMessage,
    handleMoreMessageAction,
    handleReplyToMessage,
    hoveredActionBarGroupKey,
    hoveredActionBarMessageId,
    isEmbedded,
    loadOlderMessages,
    loadingOlder,
    openImageLightbox,
    pendingReactionByMessageId,
    pendingReactionSignatureByGroupKey,
    queueHideActionBarForMessage,
    showActionBarForMessage,
    toggleMessageReaction,
  ]);

  const renderedMessageList = useMemo(
    () => {
      const messageList = (
        <ScrollShadow
        ref={messageListRef}
        className={`chat-scrollbar flex-1 min-h-0 overflow-x-hidden overscroll-contain touch-pan-y ${
          isEmbedded
            ? "space-y-3 rounded-large bg-[#0a1527]/55 px-0.5"
            : "space-y-3 rounded-large bg-[#0a1527]/62 p-2 sm:p-2.5"
        }`}
        orientation="vertical"
        style={{ WebkitOverflowScrolling: "touch" }}
        onScroll={(event) => {
          const scroller = event.currentTarget;
          const nearBottom = isNearBottom(scroller);
          shouldStickToBottomRef.current = nearBottom;
          if (nearBottom) {
            setShowJumpToLatest(false);
          }
          if (shouldVirtualizeBlocks) {
            scheduleVirtualViewportStateSync(scroller);
          }
        }}
      >
        <div
          ref={messageContentRef}
          className="w-full"
        >
          {shouldVirtualizeBlocks ? (
            <div
              className="relative w-full"
              style={{ height: `${Math.max(totalBlockHeight, 1)}px` }}
            >
              {visibleBlockLayouts.map((block) => (
                <ChatMeasuredBlock
                  key={block.key}
                  absoluteTop={block.top}
                  blockKey={block.key}
                  onMeasuredHeight={onMeasuredBlockHeight}
                >
                  {renderBlockContent(block)}
                </ChatMeasuredBlock>
              ))}
            </div>
          ) : (
            <div className="space-y-0 w-full">
              {renderBlocks.map((block) => (
                <div key={block.key} className="w-full">
                  {renderBlockContent(block)}
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollShadow>
      );

      if (!CHAT_PROFILE_ENABLED) {
        return messageList;
      }

      return (
        <Profiler id={isEmbedded ? "chat-embedded" : "chat-floating"} onRender={onChatProfilerRender}>
          {messageList}
        </Profiler>
      );
    },
    [
      isEmbedded,
      onMeasuredBlockHeight,
      onChatProfilerRender,
      renderBlocks,
      renderBlockContent,
      scheduleVirtualViewportStateSync,
      shouldVirtualizeBlocks,
      totalBlockHeight,
      visibleBlockLayouts,
    ],
  );

  const submitMessage = useCallback(async () => {
    const messageInputSnapshot = messageInput;
    const trimmedInput = messageInputSnapshot.trim();
    const attachedImageSnapshot = attachedImage;
    const attachedImageUrl = attachedImageSnapshot?.imageUrl ?? null;
    const replyContextSnapshot = replyContext;
    if ((!trimmedInput && !attachedImageUrl) || pendingImageUpload) {
      return;
    }
    const encodedMessage = encodeMessageWithReplyContext({
      message: trimmedInput,
      replyContext: replyContextSnapshot,
    });
    if (encodedMessage.length > MAX_GLOBAL_CHAT_MESSAGE_LENGTH) {
      setError(`Message must be ${MAX_GLOBAL_CHAT_MESSAGE_LENGTH} characters or fewer.`);
      return;
    }
    const composerSignature = `${encodedMessage}::${attachedImageUrl ?? ""}`;

    let idempotencyKey = composerIdempotencyKeyRef.current;
    if (!idempotencyKey || composerIdempotencyMessageRef.current !== composerSignature) {
      idempotencyKey = generateIdempotencyKey();
      composerIdempotencyKeyRef.current = idempotencyKey;
      composerIdempotencyMessageRef.current = composerSignature;
    }

    const optimisticMessageId = -Math.max(1, Math.floor(Date.now() + Math.random() * 100000));
    let previousOwnMessage: GlobalChatMessage | null = null;
    for (let index = messagesRef.current.length - 1; index >= 0; index -= 1) {
      const entry = messagesRef.current[index];
      if (entry.userId === currentUserId && toMessageId(entry.id) > 0) {
        previousOwnMessage = entry;
        break;
      }
    }
    const optimisticMessage = withNormalizedMessageReactions({
      id: optimisticMessageId,
      userId: currentUserId,
      senderLabel: previousOwnMessage?.senderLabel ?? "You",
      senderAvatarUrl: previousOwnMessage?.senderAvatarUrl ?? null,
      senderAvatarBorderColor: previousOwnMessage?.senderAvatarBorderColor ?? null,
      message: encodedMessage,
      imageUrl: attachedImageUrl,
      reactions: [],
      createdAt: new Date().toISOString(),
    });

    setPendingSend(true);
    setError(null);
    setMessageInput("");
    setAttachedImage(null);
    setReplyContext(null);
    updateChatMessages((currentMessages) => {
      const mergeResult = mergeIncomingMessages(currentMessages, [optimisticMessage]);
      if (mergeResult.droppedCount > 0) {
        incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
      }
      return mergeResult.messages;
    });
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          message: encodedMessage,
          imageUrl: attachedImageUrl,
        }),
      });
      const payload = (await response.json()) as GlobalChatResponse;
      if (!response.ok || !payload.message) {
        throw new Error(payload.error ?? "Unable to send chat message.");
      }
      const createdMessage = withNormalizedMessageReactions(payload.message);
      clearComposerIdempotency();
      updateChatMessages((currentMessages) => {
        const withoutOptimistic = currentMessages.filter(
          (entry) => toMessageId(entry.id) !== optimisticMessageId,
        );
        const mergeResult = mergeIncomingMessages(withoutOptimistic, [createdMessage]);
        latestMessageIdRef.current = toMessageId(mergeResult.messages[mergeResult.messages.length - 1]?.id ?? 0);
        if (mergeResult.droppedCount > 0) {
          incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
        }
        return mergeResult.messages;
      });
    } catch (sendError) {
      updateChatMessages((currentMessages) =>
        currentMessages.filter((entry) => toMessageId(entry.id) !== optimisticMessageId),
      );
      setMessageInput((current) => (current.trim().length > 0 ? current : messageInputSnapshot));
      setAttachedImage((current) => current ?? attachedImageSnapshot);
      setReplyContext((current) => current ?? replyContextSnapshot);
      queueIncrementalSync();
      setError(sendError instanceof Error ? sendError.message : "Unable to send chat message.");
    } finally {
      setPendingSend(false);
      if (isPanelOpen) {
        window.requestAnimationFrame(() => {
          focusChatInput();
        });
      }
    }
  }, [
    attachedImage,
    clearComposerIdempotency,
    currentUserId,
    focusChatInput,
    incrementClientMetric,
    isPanelOpen,
    messageInput,
    queueIncrementalSync,
    pendingImageUpload,
    replyContext,
    updateChatMessages,
  ]);

  useEffect(() => {
    const latestMessageIdNumber = latestPersistedMessageId;
    if (!hasInitializedUnreadState) {
      if (loading) {
        return;
      }
      setHasInitializedUnreadState(true);
      setLastSeenMessageId(latestMessageIdNumber);
      setUnreadCount(0);
      return;
    }

    if (isPanelOpen) {
      if (lastSeenMessageId !== latestMessageIdNumber) {
        setLastSeenMessageId(latestMessageIdNumber);
      }
      if (unreadCount !== 0) {
        setUnreadCount(0);
      }
      return;
    }

    if (latestMessageIdNumber <= lastSeenMessageId) {
      return;
    }

    const nextUnreadCount = sortedMessages.filter(
      (entry) => toMessageId(entry.id) > lastSeenMessageId && entry.userId !== currentUserId,
    ).length;
    setUnreadCount(nextUnreadCount);
  }, [
    currentUserId,
    hasInitializedUnreadState,
    isPanelOpen,
    lastSeenMessageId,
    latestPersistedMessageId,
    loading,
    sortedMessages,
    unreadCount,
  ]);

  const openChat = () => {
    if (isEmbedded) {
      return;
    }
    setPanelOpen(true);
    setShowJumpToLatest(false);
    setLastSeenMessageId(latestPersistedMessageId);
    setUnreadCount(0);
    window.requestAnimationFrame(() => {
      focusChatInput();
    });
  };

  const closeChat = () => {
    if (isEmbedded) {
      return;
    }
    if (incrementalTrueUpTimeoutRef.current !== null) {
      window.clearTimeout(incrementalTrueUpTimeoutRef.current);
      incrementalTrueUpTimeoutRef.current = null;
    }
    cancelActionBarHide();
    pendingActionBarProfileRef.current = null;
    setPanelOpen(false);
    setShowJumpToLatest(false);
    setReplyContext(null);
    setHoveredActionBarMessageId(null);
    setHiddenActionBarMessageId(null);
    setLightboxImage(null);
  };

  const toggleChat = () => {
    if (isEmbedded) {
      return;
    }
    if (isPanelOpen) {
      closeChat();
      return;
    }
    openChat();
  };

  const shellContainerClassName = isEmbedded
    ? "pointer-events-auto flex h-full min-h-0 flex-col"
    : isPanelOpen && isMobileViewport
    ? "pointer-events-none fixed inset-0 z-[120] flex flex-col"
    : "pointer-events-none fixed bottom-3 left-0 right-0 z-[120] flex flex-col items-end gap-2 px-3 sm:bottom-4 sm:left-auto sm:right-4 sm:px-0";
  const hasComposerAuxContent = Boolean(attachedImage || replyContext || pendingImageUpload || error);

  useEffect(() => {
    onUnreadCountChange?.(unreadCount);
  }, [onUnreadCountChange, unreadCount]);

  if (hideOnMobile && isMobileViewport) {
    return null;
  }

  return (
    <div className={shellContainerClassName}>
      {!isEmbedded && isPanelOpen ? (
        <button
          aria-label="Close chat"
          className="pointer-events-auto fixed inset-0 hidden cursor-default bg-black/35 sm:block"
          type="button"
          onClick={closeChat}
        />
      ) : null}

      {isPanelOpen ? (
        <Card
          className={`pointer-events-auto relative z-10 flex min-h-0 flex-col overflow-hidden overscroll-none text-slate-100 ${
            isEmbedded
              ? "h-full w-full rounded-none border-0 bg-transparent shadow-none"
              : isMobileViewport
              ? "h-full w-full flex-1 rounded-none border-0 bg-[#0d1728]/96"
              : "w-[380px] max-h-[min(700px,86dvh)] rounded-2xl border border-white/10 bg-[#0d1728]/94 shadow-[0_18px_44px_rgba(4,9,20,0.5)] backdrop-blur-md"
          } ${className ?? ""}`}
          style={
            !isEmbedded && isMobileViewport
              ? { height: "var(--chat-vvh, 100dvh)", minHeight: "100svh" }
              : undefined
          }
        >
          {!isEmbedded ? (
            <CardHeader
              className="flex items-center justify-between border-b border-white/10 px-3 pb-1.5 pt-2"
              style={{
                paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
                paddingLeft: "calc(env(safe-area-inset-left) + 0.75rem)",
                paddingRight: "calc(env(safe-area-inset-right) + 0.75rem)",
              }}
            >
              <h2 className="text-sm font-semibold text-[#d6e3f8] sm:text-base">
                Chat · INSIGHT Fantasy
              </h2>
              <Button
                isIconOnly
                aria-label="Minimize chat"
                className="h-11 w-11 text-slate-300 data-[hover=true]:bg-white/5 data-[hover=true]:text-white sm:h-8 sm:w-8"
                size="sm"
                variant="light"
                onPress={closeChat}
              >
                <ChevronLeft className="h-4 w-4 sm:hidden" />
                <ChevronDown className="hidden h-4 w-4 sm:block" />
              </Button>
            </CardHeader>
          ) : null}
          <CardBody
            className={`relative flex min-h-0 flex-1 flex-col ${
              isEmbedded ? "gap-2 p-0" : "gap-2 p-2.5 sm:p-3"
            }`}
            style={
              isEmbedded
                ? undefined
                : {
                    paddingLeft: "calc(env(safe-area-inset-left) + 0.625rem)",
                    paddingRight: "calc(env(safe-area-inset-right) + 0.625rem)",
                  }
            }
          >
            <div className="relative flex min-h-0 flex-1 flex-col">
              {loading ? (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <Spinner label="Loading chat..." />
                </div>
              ) : (
                renderedMessageList
              )}
              {!loading && !isEmbedded ? (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-[#0d1728]/82 to-transparent" />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-5 bg-gradient-to-t from-[#0d1728]/82 to-transparent" />
                </>
              ) : null}
            </div>

            {showJumpToLatest ? (
              <div className="mb-1 mt-1 flex justify-center">
                <Button
                  className="h-11 min-h-11 rounded-full bg-[#15263f]/78 px-3.5 text-xs font-medium text-[#c3d3ed] data-[hover=true]:bg-[#1a2e4d] sm:h-8 sm:min-h-8 sm:px-3 sm:text-[11px]"
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    scrollMessagesToBottom("smooth");
                  }}
                >
                  New messages
                </Button>
              </div>
            ) : null}

            <div
              className={`mt-auto ${
                isEmbedded
                  ? hasComposerAuxContent
                    ? "border-t border-white/5 py-1"
                    : "border-t border-white/5"
                  : hasComposerAuxContent
                  ? "border-t border-white/10 pt-0.5"
                  : "border-t border-white/10"
              }`}
              style={
                isEmbedded
                  ? undefined
                  : {
                      paddingBottom: hasComposerAuxContent
                        ? "calc(env(safe-area-inset-bottom) + 0.15rem)"
                        : "env(safe-area-inset-bottom)",
                      paddingLeft: "calc(env(safe-area-inset-left) + 0.625rem)",
                      paddingRight: "calc(env(safe-area-inset-right) + 0.625rem)",
                    }
              }
            >
              <input
                ref={chatImageInputRef}
                accept={CHAT_IMAGE_ACCEPT_VALUE}
                className="hidden"
                type="file"
                onChange={handleImageInputChange}
              />
              {attachedImage ? (
                <div className="mb-2 rounded-xl bg-[#111f34]/70 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] text-[#b7c7e3]">
                      Attached image: {attachedImage.fileName}
                    </p>
                    <Button
                      isIconOnly
                      aria-label="Remove attached image"
                      className="h-6 w-6 min-h-6 min-w-6 text-[#b7c7e3] data-[hover=true]:bg-white/5 data-[hover=true]:text-[#e8f0ff]"
                      isDisabled={pendingSend || pendingImageUpload}
                      size="sm"
                      variant="light"
                      onPress={removeAttachedImage}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <a
                    className="mt-2 block"
                    href={attachedImage.imageUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="Attached chat image preview"
                      className="max-h-40 w-auto max-w-full rounded-lg object-cover"
                      src={attachedImage.imageUrl}
                    />
                  </a>
                </div>
              ) : null}
              {replyContext ? (
                <div className="mb-2 flex items-start justify-between gap-2 rounded-xl border border-white/10 bg-[#111f34]/75 px-2.5 py-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9fb3d6]/80">
                      Replying to {replyContext.senderLabel}
                    </p>
                    <p className="truncate text-xs text-[#dbe7fb]/85">
                      {replyContext.snippet}
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    aria-label="Cancel reply"
                    className="h-6 w-6 min-h-6 min-w-6 text-[#b7c7e3] data-[hover=true]:bg-white/5 data-[hover=true]:text-[#e8f0ff]"
                    isDisabled={pendingSend}
                    size="sm"
                    variant="light"
                    onPress={() => {
                      setReplyContext(null);
                    }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ) : null}
              {pendingImageUpload ? (
                <p className="mb-2 text-xs text-[#9fb3d6]">Uploading image...</p>
              ) : null}
              <div className={hasComposerAuxContent ? "" : isEmbedded ? "py-1" : "py-2"}>
                <form
                  autoComplete="off"
                  className="flex items-center gap-1.5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void submitMessage();
                  }}
                >
                  <Button
                    isIconOnly
                    aria-label="Attach image"
                    className="h-9 w-9 min-h-9 min-w-9 self-center text-[#b9c9e4] data-[hover=true]:bg-white/6 data-[hover=true]:text-white data-[disabled=true]:opacity-45"
                    isDisabled={pendingSend || pendingImageUpload}
                    type="button"
                    variant="light"
                    onPress={openChatImagePicker}
                  >
                    <ImagePlus className="h-4 w-4" />
                  </Button>
                  <label className="sr-only" htmlFor={CHAT_COMPOSER_FIELD_ID}>
                    Type text
                  </label>
                  <div className="relative flex-1 rounded-[14px] bg-white/[0.05] transition-colors focus-within:bg-white/[0.07]">
                    <textarea
                      ref={chatInputRef}
                      id={CHAT_COMPOSER_FIELD_ID}
                      name={CHAT_COMPOSER_FIELD_NAME}
                      aria-label="Type text"
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      className={`chat-scrollbar w-full resize-none rounded-[14px] border border-transparent bg-transparent outline-none transition focus:border-transparent focus:ring-1 focus:ring-white/20 ${
                        isEmbedded
                          ? "min-h-[30px] max-h-[72px] px-2.5 py-1 text-[13px] leading-[1.1rem] text-[#edf2ff]"
                          : "min-h-[36px] max-h-[96px] px-3 py-1.5 text-sm leading-5 text-[#edf2ff]"
                      }`}
                      data-gramm="false"
                      enterKeyHint="send"
                      inputMode="text"
                      maxLength={messageInputMaxLength}
                      placeholder={
                        replyContext
                          ? `Reply to ${replyContext.senderLabel}`
                          : "Type a message or add image"
                      }
                      rows={1}
                      spellCheck={false}
                      value={messageInput}
                      onChange={(event) => {
                        const nextValue = event.currentTarget.value.replace(/\u00a0/g, " ");
                        const encodedMessage = encodeMessageWithReplyContext({
                          message: nextValue,
                          replyContext,
                        });
                        const signature = `${encodedMessage}::${attachedImage?.imageUrl ?? ""}`;
                        if (signature !== composerIdempotencyMessageRef.current) {
                          clearComposerIdempotency();
                        }
                        setMessageInput(nextValue);
                        queueComposerHeightSync(event.currentTarget);
                      }}
                      onFocus={() => {
                        if (!shouldStickToBottomRef.current) {
                          return;
                        }
                        window.requestAnimationFrame(() => {
                          scrollMessagesToBottom();
                        });
                        if (viewportSettleTimeoutRef.current !== null) {
                          window.clearTimeout(viewportSettleTimeoutRef.current);
                        }
                        viewportSettleTimeoutRef.current = window.setTimeout(() => {
                          scrollMessagesToBottom();
                          viewportSettleTimeoutRef.current = null;
                        }, 90);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void submitMessage();
                        }
                      }}
                      onPaste={handleComposerPaste}
                    />
                  </div>
                  {!isEmbedded ? (
                    <Button
                      isIconOnly
                      aria-label="Close chat"
                      className="h-9 w-9 min-h-9 min-w-9 self-center text-slate-300 data-[hover=true]:bg-white/6 data-[hover=true]:text-white sm:hidden"
                      type="button"
                      variant="light"
                      onPress={closeChat}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button
                    aria-label="Send message"
                    className="h-9 w-9 min-h-9 min-w-9 self-center bg-transparent text-[#c4d5ef] shadow-none hover:bg-transparent active:bg-transparent data-[hover=true]:bg-white/6 data-[hover=true]:text-white data-[pressed=true]:bg-transparent data-[disabled=true]:opacity-45"
                    isIconOnly
                    isDisabled={
                      pendingSend ||
                      pendingImageUpload ||
                      (messageInput.trim().length === 0 && !attachedImage)
                    }
                    isLoading={pendingSend}
                    type="submit"
                    variant="light"
                    onMouseDown={(event) => {
                      event.preventDefault();
                    }}
                    onTouchStart={(event) => {
                      event.preventDefault();
                    }}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </div>
              {error ? <p className="mt-1 text-sm text-danger-400">{error}</p> : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Modal
        classNames={{ wrapper: "z-[260]" }}
        hideCloseButton
        isOpen={lightboxImage !== null}
        placement="center"
        size="4xl"
        onOpenChange={(open) => {
          if (!open) {
            closeImageLightbox();
          }
        }}
      >
        <ModalContent className="border border-white/10 bg-[#0b1629]/96 text-[#e6efff]">
          {(onClose) => (
            <ModalBody className="space-y-2 p-2.5 sm:p-3">
              {lightboxImage ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] text-[#aabddf]/85 sm:text-xs">
                      {lightboxImage.senderLabel} · {formatTime(lightboxImage.createdAt)}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        isIconOnly
                        aria-label="Open image in new tab"
                        className="h-9 w-9 min-h-9 min-w-9 text-[#dbe7fb] data-[hover=true]:bg-white/10 data-[hover=true]:text-white"
                        size="sm"
                        variant="light"
                        onPress={() => {
                          window.open(lightboxImage.imageUrl, "_blank", "noopener,noreferrer");
                        }}
                      >
                        <ExternalLink className="h-4.5 w-4.5" />
                      </Button>
                      <Button
                        isIconOnly
                        aria-label="Close image viewer"
                        className="h-10 w-10 min-h-10 min-w-10 rounded-full text-[#c5d5ef] data-[hover=true]:bg-white/10 data-[hover=true]:text-white"
                        size="sm"
                        variant="light"
                        onPress={onClose}
                      >
                        <X className="h-5 w-5" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex max-h-[78vh] min-h-[220px] items-center justify-center overflow-hidden rounded-large bg-black/35">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      alt="Chat attachment full size"
                      className="max-h-[78vh] w-auto max-w-full object-contain"
                      src={lightboxImage.imageUrl}
                    />
                  </div>
                </>
              ) : null}
            </ModalBody>
          )}
        </ModalContent>
      </Modal>

      {!isEmbedded && !hideLauncherButton ? (
        <Button
          isIconOnly={isPanelOpen}
          aria-label={isPanelOpen ? "Close chat" : "Open chat"}
          className={`pointer-events-auto relative z-10 rounded-full border border-[#C79B3B]/80 bg-[#C79B3B] text-[#2a2006] shadow-none transition-colors hover:bg-[#C79B3B] active:bg-[#C79B3B] data-[hover=true]:bg-[#C79B3B] data-[pressed=true]:bg-[#C79B3B] ${
            isPanelOpen ? "hidden h-11 w-11 min-h-11 min-w-11 px-0 sm:inline-flex" : ""
          }`}
          color="default"
          radius="full"
          variant="solid"
          onPress={toggleChat}
        >
          {isPanelOpen ? (
            <X className="h-4 w-4" />
          ) : (
            <span className="inline-flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Chat
            </span>
          )}
          {!isPanelOpen && unreadCount > 0 ? (
            <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full border border-[#C79B3B]/50 bg-[#121f34] px-1.5 text-[11px] font-semibold text-[#C79B3B]">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Button>
      ) : null}
    </div>
  );
};
