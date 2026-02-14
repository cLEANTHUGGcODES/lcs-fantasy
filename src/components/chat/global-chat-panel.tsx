"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Spinner } from "@heroui/spinner";
import { ChevronDown, ChevronLeft, MessageCircle, Send } from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { GlobalChatMessage } from "@/types/chat";

type GlobalChatResponse = {
  messages?: GlobalChatMessage[];
  message?: GlobalChatMessage;
  hasMore?: boolean;
  nextBeforeId?: number | null;
  duplicate?: boolean;
  error?: string;
};

const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;
const CHAT_INITIAL_FETCH_LIMIT = 120;
const CHAT_INCREMENTAL_FETCH_LIMIT = 60;
const CHAT_PAGE_FETCH_LIMIT = 80;
const CHAT_FALLBACK_POLL_INTERVAL_MS = 10000;
const CHAT_WAKE_SYNC_DEBOUNCE_MS = 400;
const CHAT_METRICS_FLUSH_INTERVAL_MS = 60000;
const CHAT_AUTO_SCROLL_THRESHOLD_PX = 72;
const CHAT_COMPOSER_MIN_HEIGHT_PX = 30;
const CHAT_COMPOSER_MAX_HEIGHT_PX = 80;

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

export const GlobalChatPanel = ({
  currentUserId,
  className,
}: {
  currentUserId: string;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [messages, setMessages] = useState<GlobalChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [oldestCursorId, setOldestCursorId] = useState<number | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [pendingSend, setPendingSend] = useState(false);
  const [hasInitializedUnreadState, setHasInitializedUnreadState] = useState(false);
  const [lastSeenMessageId, setLastSeenMessageId] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerResizeFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const latestMessageIdRef = useRef(0);
  const realtimeConnectedRef = useRef(false);
  const incrementalSyncInFlightRef = useRef(false);
  const incrementalSyncQueuedRef = useRef(false);
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
  const sortedMessages = messages;
  const groupedMessages = useMemo(() => {
    return sortedMessages.reduce<
      Array<{
        userId: string;
        senderLabel: string;
        senderAvatarUrl: string | null;
        senderAvatarBorderColor: string | null;
        dayKey: string;
        dayLabel: string;
        isCurrentUser: boolean;
        messages: GlobalChatMessage[];
      }>
    >((groups, entry) => {
      const dayKey = formatDayKey(entry.createdAt);
      const previous = groups[groups.length - 1];
      if (previous && previous.userId === entry.userId && previous.dayKey === dayKey) {
        previous.messages.push(entry);
        return groups;
      }

      groups.push({
        userId: entry.userId,
        senderLabel: entry.senderLabel,
        senderAvatarUrl: entry.senderAvatarUrl,
        senderAvatarBorderColor: entry.senderAvatarBorderColor,
        dayKey,
        dayLabel: formatDayLabel(entry.createdAt),
        isCurrentUser: entry.userId === currentUserId,
        messages: [entry],
      });
      return groups;
    }, []);
  }, [currentUserId, sortedMessages]);

  const syncComposerHeight = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = "auto";
    const nextHeight = Math.min(
      Math.max(target.scrollHeight, CHAT_COMPOSER_MIN_HEIGHT_PX),
      CHAT_COMPOSER_MAX_HEIGHT_PX,
    );
    target.style.height = `${nextHeight}px`;
    target.style.overflowY = target.scrollHeight > CHAT_COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

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

      if (mode === "replace") {
        const nextMessages = payload.messages;
        const nextOldestCursorId = payload.nextBeforeId
          ?? (() => {
            const firstMessageId = toMessageId(nextMessages[0]?.id ?? 0);
            return firstMessageId > 0 ? firstMessageId : null;
          })();
        setMessages(nextMessages);
        latestMessageIdRef.current = toMessageId(nextMessages[nextMessages.length - 1]?.id ?? 0);
        setHasOlderMessages(payload.hasMore === true);
        setOldestCursorId(nextOldestCursorId);
        return;
      }

      if (mode === "incremental") {
        setMessages((currentMessages) => {
          const mergeResult = mergeIncomingMessages(currentMessages, payload.messages ?? []);
          latestMessageIdRef.current = toMessageId(mergeResult.messages[mergeResult.messages.length - 1]?.id ?? 0);
          if (mergeResult.droppedCount > 0) {
            incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
          }
          return mergeResult.messages;
        });
        return;
      }

      if (mode === "older") {
        setMessages((currentMessages) => {
          const mergeResult = prependOlderMessages(currentMessages, payload.messages ?? []);
          if (mergeResult.droppedCount > 0) {
            incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
          }
          return mergeResult.messages;
        });
        setHasOlderMessages(payload.hasMore === true);
        setOldestCursorId(payload.nextBeforeId ?? null);
      }
    },
    [incrementClientMetric],
  );

  const queueIncrementalSync = useCallback(() => {
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

  const scheduleWakeSync = useCallback(() => {
    if (wakeSyncTimeoutRef.current !== null) {
      window.clearTimeout(wakeSyncTimeoutRef.current);
    }
    wakeSyncTimeoutRef.current = window.setTimeout(() => {
      wakeSyncTimeoutRef.current = null;
      queueIncrementalSync();
    }, CHAT_WAKE_SYNC_DEBOUNCE_MS);
  }, [queueIncrementalSync]);

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
        () => {
          queueIncrementalSync();
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
  }, [incrementClientMetric, queueIncrementalSync]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (realtimeConnectedRef.current) {
        return;
      }
      incrementClientMetric("fallbackSyncs");
      queueIncrementalSync();
    }, CHAT_FALLBACK_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [incrementClientMetric, queueIncrementalSync]);

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
    if (!isOpen) {
      return;
    }

    const el = messageListRef.current;
    if (!el) {
      return;
    }

    shouldStickToBottomRef.current = true;
    window.requestAnimationFrame(() => {
      const current = messageListRef.current;
      if (!current) {
        return;
      }
      current.scrollTop = current.scrollHeight;
      shouldStickToBottomRef.current = true;
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !shouldStickToBottomRef.current) {
      return;
    }

    const el = messageListRef.current;
    if (!el) {
      return;
    }

    el.scrollTop = el.scrollHeight;
  }, [isOpen, sortedMessages]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const input = chatInputRef.current;
    if (!input) {
      return;
    }
    queueComposerHeightSync(input);
  }, [isOpen, queueComposerHeightSync]);

  useEffect(() => {
    return () => {
      if (composerResizeFrameRef.current !== null) {
        window.cancelAnimationFrame(composerResizeFrameRef.current);
        composerResizeFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !isMobileViewport) {
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
  }, [isOpen, isMobileViewport]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasOlderMessages || !oldestCursorId) {
      return;
    }

    setLoadingOlder(true);
    setError(null);
    try {
      await loadMessages({
        mode: "older",
        beforeId: oldestCursorId,
        limit: CHAT_PAGE_FETCH_LIMIT,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load older messages.");
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlderMessages, loadMessages, loadingOlder, oldestCursorId]);

  const renderedMessageList = useMemo(
    () => (
      <div
        ref={messageListRef}
        className="chat-scrollbar flex-1 min-h-0 space-y-1.5 overflow-x-hidden overflow-y-auto overscroll-contain px-1 pb-1 touch-pan-y sm:space-y-2 sm:rounded-large sm:border sm:border-[#334767]/55 sm:bg-[#081326]/88 sm:p-3"
        style={{ WebkitOverflowScrolling: "touch" }}
        onScroll={(event) => {
          shouldStickToBottomRef.current = isNearBottom(event.currentTarget);
        }}
      >
        {hasOlderMessages ? (
          <div className="mb-2 flex justify-center">
            <Button
              className="h-7 min-h-7 rounded-full border border-[#3f5578]/80 bg-[#0f1d33]/90 px-3 text-[11px] font-semibold text-[#c5d5f1] data-[hover=true]:bg-[#14253f]"
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
        ) : null}
        {sortedMessages.length === 0 ? (
          <p className="text-sm text-slate-300">No messages yet. Start the banter.</p>
        ) : (
          groupedMessages.map((group, groupIndex) => {
            const previousGroup = groupedMessages[groupIndex - 1];
            const showDaySeparator = !previousGroup || previousGroup.dayKey !== group.dayKey;
            return (
              <div
                key={`${group.userId}-${group.messages[0]?.id ?? 0}-${group.messages[group.messages.length - 1]?.id ?? 0}`}
                className="space-y-0.5"
              >
                {showDaySeparator ? (
                  <div className="my-2.5 flex items-center gap-2 px-1">
                    <span className="h-px flex-1 bg-[#3a4f72]/55" />
                    <span className="text-[10px] font-medium tracking-wide text-[#9fb3d6]/90">
                      {group.dayLabel}
                    </span>
                    <span className="h-px flex-1 bg-[#3a4f72]/55" />
                  </div>
                ) : null}
                {!group.isCurrentUser ? (
                  <p className="px-10 text-left text-[10px] font-medium tracking-wide text-[#C79B3B]">
                    {group.senderLabel}
                  </p>
                ) : null}
                <div className="space-y-0.5">
                  {group.messages.map((entry, index) => {
                    const showAvatar = index === group.messages.length - 1;
                    const avatarBorderStyle = group.senderAvatarBorderColor
                      ? { outlineColor: group.senderAvatarBorderColor }
                      : undefined;
                    const avatar = showAvatar ? (
                      <span
                        className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[#16233a] outline outline-2 outline-[#C79B3B]/40"
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
                          <span className="inline-flex h-full w-full items-center justify-center text-[10px] font-semibold text-[#C79B3B]">
                            {initialsForSenderLabel(group.senderLabel)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="h-7 w-7 shrink-0" />
                    );

                    const bubble = (
                      <div
                        className={`max-w-[82%] rounded-2xl border px-2 py-1 sm:max-w-[88%] sm:px-2.5 sm:py-1.5 ${
                          group.isCurrentUser
                            ? "border-[#6c83a6]/70 bg-[#1b2a44]/92 text-[#f7faff] shadow-[0_8px_20px_rgba(11,18,33,0.32)]"
                            : "border-[#3f5578]/75 bg-[#101c2f]/92 text-[#edf2ff] shadow-[0_8px_18px_rgba(8,12,24,0.4)]"
                        }`}
                      >
                        <p className={`text-[10px] ${group.isCurrentUser ? "text-[#c9d7ef]" : "text-[#9fb3d6]"}`}>
                          {formatTime(entry.createdAt)}
                        </p>
                        <p
                          className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.35rem] sm:mt-0.5 sm:text-sm ${
                            group.isCurrentUser ? "text-[#f7faff]" : "text-[#edf2ff]"
                          }`}
                        >
                          {entry.message}
                        </p>
                      </div>
                    );

                    return (
                      <div
                        key={entry.id}
                        className={`flex items-end gap-2 px-0.5 ${
                          group.isCurrentUser ? "justify-end" : "justify-start"
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
          })
        )}
      </div>
    ),
    [groupedMessages, hasOlderMessages, loadOlderMessages, loadingOlder, sortedMessages.length],
  );

  const submitMessage = useCallback(async () => {
    const trimmed = messageInput.trim();
    if (!trimmed) {
      return;
    }

    let idempotencyKey = composerIdempotencyKeyRef.current;
    if (!idempotencyKey || composerIdempotencyMessageRef.current !== trimmed) {
      idempotencyKey = generateIdempotencyKey();
      composerIdempotencyKeyRef.current = idempotencyKey;
      composerIdempotencyMessageRef.current = trimmed;
    }

    setPendingSend(true);
    setError(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          message: trimmed,
        }),
      });
      const payload = (await response.json()) as GlobalChatResponse;
      if (!response.ok || !payload.message) {
        throw new Error(payload.error ?? "Unable to send chat message.");
      }
      const createdMessage = payload.message;
      setMessageInput("");
      composerIdempotencyKeyRef.current = null;
      composerIdempotencyMessageRef.current = "";
      setMessages((currentMessages) => {
        const mergeResult = mergeIncomingMessages(currentMessages, [createdMessage]);
        latestMessageIdRef.current = toMessageId(mergeResult.messages[mergeResult.messages.length - 1]?.id ?? 0);
        if (mergeResult.droppedCount > 0) {
          incrementClientMetric("duplicateDrops", mergeResult.droppedCount);
        }
        return mergeResult.messages;
      });
      window.requestAnimationFrame(() => {
        focusChatInput();
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send chat message.");
    } finally {
      setPendingSend(false);
    }
  }, [focusChatInput, incrementClientMetric, messageInput]);

  useEffect(() => {
    const latestMessageId = sortedMessages[sortedMessages.length - 1]?.id ?? 0;
    const latestMessageIdNumber = toMessageId(latestMessageId);
    if (!hasInitializedUnreadState) {
      if (loading) {
        return;
      }
      setHasInitializedUnreadState(true);
      setLastSeenMessageId(latestMessageIdNumber);
      setUnreadCount(0);
      return;
    }

    if (isOpen) {
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
    isOpen,
    lastSeenMessageId,
    loading,
    sortedMessages,
    unreadCount,
  ]);

  const openChat = () => {
    setIsOpen(true);
    const latestMessageId = toMessageId(sortedMessages[sortedMessages.length - 1]?.id ?? 0);
    setLastSeenMessageId(latestMessageId);
    setUnreadCount(0);
    window.requestAnimationFrame(() => {
      focusChatInput();
    });
  };

  const closeChat = () => {
    setIsOpen(false);
  };

  const toggleChat = () => {
    if (isOpen) {
      closeChat();
      return;
    }
    openChat();
  };

  return (
    <div className="pointer-events-none fixed bottom-3 left-0 right-0 z-[120] flex flex-col items-end gap-2 px-3 sm:bottom-4 sm:left-auto sm:right-4 sm:px-0">
      {isOpen ? (
        <button
          aria-label="Close chat"
          className="pointer-events-auto fixed inset-0 hidden cursor-default bg-black/35 sm:block"
          type="button"
          onClick={closeChat}
        />
      ) : null}

      {isOpen ? (
        <Card
          className={`pointer-events-auto fixed inset-0 z-10 flex h-[100svh] min-h-[100svh] w-full flex-col overflow-hidden overscroll-none rounded-none bg-gradient-to-b from-[#081325] via-[#0d1a30] to-[#13223a] text-slate-100 supports-[height:100dvh]:h-[100dvh] supports-[height:100dvh]:min-h-[100dvh] sm:relative sm:h-auto sm:min-h-0 sm:max-h-[min(700px,86dvh)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-[#C79B3B]/35 sm:shadow-2xl sm:backdrop-blur-md ${className ?? ""}`}
        >
          <CardHeader
            className="flex items-center justify-between border-b border-[#344867]/60 px-3 pb-1.5 pt-2"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
              paddingLeft: "calc(env(safe-area-inset-left) + 0.75rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 0.75rem)",
            }}
          >
            <div>
              <h2 className="text-sm font-semibold text-[#C79B3B] sm:text-base">
                INSIGHT Fantasy Chat
              </h2>
            </div>
            <Button
              isIconOnly
              aria-label="Minimize chat"
              className="text-slate-300 data-[hover=true]:text-[#C79B3B]"
              size="sm"
              variant="light"
              onPress={closeChat}
            >
              <ChevronLeft className="h-4 w-4 sm:hidden" />
              <ChevronDown className="hidden h-4 w-4 sm:block" />
            </Button>
          </CardHeader>
          <CardBody
            className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:gap-3 sm:p-3"
            style={{
              paddingLeft: "calc(env(safe-area-inset-left) + 0.625rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 0.625rem)",
            }}
          >
            {loading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <Spinner label="Loading chat..." />
              </div>
            ) : (
              renderedMessageList
            )}

            <div
              className="-mx-2.5 mt-auto border-t border-[#344a69]/55 bg-[#091325]/96 px-2.5 pt-1.5 sm:mx-0 sm:mt-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0"
              style={{
                paddingBottom: "calc(env(safe-area-inset-bottom) + 0.08rem)",
                marginLeft: "calc(env(safe-area-inset-left) * -1)",
                marginRight: "calc(env(safe-area-inset-right) * -1)",
              }}
            >
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <textarea
                    ref={chatInputRef}
                    aria-label="Chat message"
                    autoCorrect="on"
                    className="chat-scrollbar min-h-[30px] max-h-[80px] w-full resize-none rounded-md border border-transparent bg-[#081326] px-3 py-1 text-base leading-5 text-[#edf2ff] outline-none transition focus:border-transparent focus:ring-2 focus:ring-[#C79B3B]/25"
                    data-gramm="false"
                    disabled={pendingSend}
                    enterKeyHint="send"
                    maxLength={MAX_GLOBAL_CHAT_MESSAGE_LENGTH}
                    placeholder="Message"
                    rows={1}
                    spellCheck
                    value={messageInput}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value.replace(/\u00a0/g, " ");
                      if (nextValue.trim() !== composerIdempotencyMessageRef.current) {
                        composerIdempotencyKeyRef.current = null;
                        composerIdempotencyMessageRef.current = "";
                      }
                      setMessageInput(nextValue);
                      queueComposerHeightSync(event.currentTarget);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void submitMessage();
                      }
                    }}
                  />
                </div>
                <Button
                  aria-label="Send message"
                  className="h-[30px] w-[30px] min-h-[30px] min-w-[30px] self-center bg-transparent text-[#C79B3B] shadow-none hover:bg-transparent active:bg-transparent data-[hover=true]:bg-transparent data-[hover=true]:text-[#C79B3B] data-[pressed=true]:bg-transparent data-[disabled=true]:opacity-45"
                  isIconOnly
                  isDisabled={messageInput.trim().length === 0}
                  isLoading={pendingSend}
                  variant="light"
                  onPress={() => {
                    void submitMessage();
                  }}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {error ? <p className="mt-1 text-sm text-danger-400">{error}</p> : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Button
        className={`pointer-events-auto relative z-10 rounded-full border border-[#C79B3B]/80 bg-[#C79B3B] text-[#2a2006] shadow-none transition-colors hover:bg-[#C79B3B] active:bg-[#C79B3B] data-[hover=true]:bg-[#C79B3B] data-[pressed=true]:bg-[#C79B3B] ${
          isOpen ? "hidden sm:inline-flex" : ""
        }`}
        color="default"
        radius="full"
        variant="solid"
        onPress={toggleChat}
      >
        <span className="inline-flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          Chat
        </span>
        {unreadCount > 0 ? (
          <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full border border-[#C79B3B]/50 bg-[#121f34] px-1.5 text-[11px] font-semibold text-[#C79B3B]">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Button>
    </div>
  );
};
