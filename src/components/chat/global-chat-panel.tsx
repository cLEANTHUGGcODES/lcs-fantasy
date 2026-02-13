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
  error?: string;
};

const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;
const CHAT_POLL_INTERVAL_MS = 2500;

const toMessageId = (value: unknown): number => {
  const normalized = typeof value === "number"
    ? value
    : Number.parseInt(`${value ?? ""}`, 10);
  return Number.isFinite(normalized) ? normalized : 0;
};

const formatTime = (value: string): string =>
  new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

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
  const [error, setError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [pendingSend, setPendingSend] = useState(false);
  const [hasInitializedUnreadState, setHasInitializedUnreadState] = useState(false);
  const [lastSeenMessageId, setLastSeenMessageId] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isComposerFocused, setIsComposerFocused] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLDivElement | null>(null);
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );
  const groupedMessages = useMemo(() => {
    return sortedMessages.reduce<
      Array<{
        userId: string;
        senderLabel: string;
        senderAvatarUrl: string | null;
        isCurrentUser: boolean;
        messages: GlobalChatMessage[];
      }>
    >((groups, entry) => {
      const previous = groups[groups.length - 1];
      if (previous && previous.userId === entry.userId) {
        previous.messages.push(entry);
        return groups;
      }

      groups.push({
        userId: entry.userId,
        senderLabel: entry.senderLabel,
        senderAvatarUrl: entry.senderAvatarUrl,
        isCurrentUser: entry.userId === currentUserId,
        messages: [entry],
      });
      return groups;
    }, []);
  }, [currentUserId, sortedMessages]);

  const moveCaretToEnd = useCallback((target: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const focusChatInput = useCallback(() => {
    const input = chatInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    moveCaretToEnd(input);
  }, [moveCaretToEnd]);

  const loadMessages = useCallback(async () => {
    const response = await fetch("/api/chat", {
      cache: "no-store",
    });
    const payload = (await response.json()) as GlobalChatResponse;
    if (!response.ok || !payload.messages) {
      throw new Error(payload.error ?? "Unable to load chat.");
    }
    setMessages(payload.messages);
  }, []);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        await loadMessages();
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
          event: "*",
          schema: "public",
          table: "fantasy_global_chat_messages",
        },
        () => {
          void loadMessages().catch(() => undefined);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMessages]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadMessages().catch(() => undefined);
    }, CHAT_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [loadMessages]);

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
    el.scrollTop = el.scrollHeight;
  }, [isOpen, sortedMessages]);

  useEffect(() => {
    if (!isOpen || !isMobileViewport) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;

    const previous = {
      htmlOverflow: html.style.overflow,
      htmlHeight: html.style.height,
      htmlOverscrollBehaviorY: html.style.overscrollBehaviorY,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
      bodyOverscrollBehaviorY: body.style.overscrollBehaviorY,
    };

    html.style.overflow = "hidden";
    html.style.height = "100%";
    html.style.overscrollBehaviorY = "none";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overscrollBehaviorY = "none";

    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.height = previous.htmlHeight;
      html.style.overscrollBehaviorY = previous.htmlOverscrollBehaviorY;
      body.style.overflow = previous.bodyOverflow;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.width = previous.bodyWidth;
      body.style.overscrollBehaviorY = previous.bodyOverscrollBehaviorY;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen, isMobileViewport]);

  const submitMessage = useCallback(async () => {
    const trimmed = messageInput.trim();
    if (!trimmed) {
      return;
    }

    setPendingSend(true);
    setError(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
        }),
      });
      const payload = (await response.json()) as GlobalChatResponse;
      if (!response.ok || !payload.message) {
        throw new Error(payload.error ?? "Unable to send chat message.");
      }
      setMessageInput("");
      if (chatInputRef.current) {
        chatInputRef.current.textContent = "";
      }
      await loadMessages();
      window.requestAnimationFrame(() => {
        focusChatInput();
      });
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send chat message.");
    } finally {
      setPendingSend(false);
    }
  }, [focusChatInput, loadMessages, messageInput]);

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
          className="pointer-events-auto fixed inset-0 hidden cursor-default bg-black/25 sm:block"
          type="button"
          onClick={closeChat}
        />
      ) : null}

      {isOpen ? (
        <Card
          className={`pointer-events-auto fixed inset-0 z-10 flex h-[100svh] min-h-[100svh] w-full flex-col overflow-hidden overscroll-none rounded-none bg-gradient-to-b from-[#081120] via-[#0d1a30] to-[#111d33] text-slate-100 sm:relative sm:h-auto sm:min-h-0 sm:max-h-[min(700px,86dvh)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-slate-400/45 sm:shadow-2xl sm:backdrop-blur-md ${className ?? ""}`}
        >
          <CardHeader
            className="flex items-center justify-between border-b border-slate-500/35 px-3 pb-1.5 pt-2"
            style={{
              paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)",
              paddingLeft: "calc(env(safe-area-inset-left) + 0.75rem)",
              paddingRight: "calc(env(safe-area-inset-right) + 0.75rem)",
            }}
          >
            <div>
              <h2 className="text-sm font-semibold text-white sm:text-base">
                INSIGHT Fantasy Chat
              </h2>
            </div>
            <Button
              isIconOnly
              aria-label="Minimize chat"
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
              <div
                ref={messageListRef}
                className="flex-1 min-h-0 space-y-1.5 overflow-x-hidden overflow-y-auto overscroll-contain px-1 pb-1 touch-pan-y sm:space-y-2 sm:rounded-large sm:border sm:border-slate-500/35 sm:bg-[#070f1f]/75 sm:p-3"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {sortedMessages.length === 0 ? (
                  <p className="text-sm text-slate-300">No messages yet. Start the banter.</p>
                ) : (
                  groupedMessages.map((group) => {
                    return (
                      <div
                        key={`${group.userId}-${group.messages[0]?.id ?? 0}-${group.messages[group.messages.length - 1]?.id ?? 0}`}
                        className="space-y-0.5"
                      >
                        {!group.isCurrentUser ? (
                          <p className="px-10 text-left text-[10px] font-medium text-slate-300">
                            {group.senderLabel}
                          </p>
                        ) : null}
                        <div className="space-y-0.5">
                          {group.messages.map((entry, index) => {
                            const showAvatar = index === group.messages.length - 1;
                            return (
                              <div
                                key={entry.id}
                                className={`flex items-end gap-2 px-0.5 ${
                                  group.isCurrentUser ? "justify-end" : "justify-start"
                                }`}
                              >
                                {showAvatar ? (
                                  <span className="relative inline-flex h-7 w-7 shrink-0 overflow-hidden rounded-full border border-default-300/35 bg-default-200/40">
                                    {group.senderAvatarUrl ? (
                                      <Image
                                        src={group.senderAvatarUrl}
                                        alt={`${group.senderLabel} avatar`}
                                        fill
                                        sizes="28px"
                                        className="object-cover object-center"
                                      />
                                    ) : (
                                      <span className="inline-flex h-full w-full items-center justify-center text-[10px] font-semibold text-default-700">
                                        {initialsForSenderLabel(group.senderLabel)}
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="h-7 w-7 shrink-0" />
                                )}
                                <div
                                  className={`max-w-[82%] rounded-2xl border px-2 py-1 sm:max-w-[88%] sm:px-2.5 sm:py-1.5 ${
                                    group.isCurrentUser
                                      ? "border-blue-300/70 bg-blue-500/85 text-white shadow-[0_8px_20px_rgba(59,130,246,0.28)]"
                                      : "border-slate-500/60 bg-slate-800/88 text-slate-100 shadow-[0_8px_18px_rgba(15,23,42,0.35)]"
                                  }`}
                                >
                                  <p className={`text-[10px] ${group.isCurrentUser ? "text-blue-100/90" : "text-slate-300"}`}>
                                    {formatTime(entry.createdAt)}
                                  </p>
                                  <p
                                    className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-[1.35rem] sm:mt-0.5 sm:text-sm ${
                                      group.isCurrentUser ? "text-white" : "text-slate-100"
                                    }`}
                                  >
                                    {entry.message}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <div
              className="-mx-2.5 mt-auto border-t border-slate-500/35 bg-[#091426]/95 px-2.5 pt-1.5 sm:mx-0 sm:mt-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0"
              style={{
                paddingBottom: "calc(env(safe-area-inset-bottom) + 0.08rem)",
                marginLeft: "calc(env(safe-area-inset-left) * -1)",
                marginRight: "calc(env(safe-area-inset-right) * -1)",
              }}
            >
              <div className="flex items-end gap-2 rounded-large bg-slate-900/45 p-1.5">
                <div className="relative flex-1">
                  {!isComposerFocused && messageInput.trim().length === 0 ? (
                    <span className="pointer-events-none absolute left-3 top-2 text-[13px] text-slate-400 sm:text-sm">
                      Message
                    </span>
                  ) : null}
                  <div
                    ref={chatInputRef}
                    aria-label="Chat message"
                    aria-multiline="true"
                    autoCorrect="on"
                    className="min-h-[40px] max-h-[120px] overflow-y-auto rounded-xl border border-slate-500/45 bg-[#08111f] px-3 py-2 text-[13px] leading-5 text-slate-100 outline-none transition focus:border-primary-400/70 focus:ring-2 focus:ring-primary-400/30 sm:text-sm"
                    contentEditable={!pendingSend}
                    data-gramm="false"
                    role="textbox"
                    spellCheck
                    suppressContentEditableWarning
                    onBlur={() => setIsComposerFocused(false)}
                    onFocus={() => setIsComposerFocused(true)}
                    onInput={(event) => {
                      const target = event.currentTarget;
                      const raw = target.innerText.replace(/\u00a0/g, " ");
                      const normalized = raw.length > MAX_GLOBAL_CHAT_MESSAGE_LENGTH
                        ? raw.slice(0, MAX_GLOBAL_CHAT_MESSAGE_LENGTH)
                        : raw;

                      if (normalized !== raw) {
                        target.innerText = normalized;
                        moveCaretToEnd(target);
                      }

                      setMessageInput(normalized);
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
                  color="primary"
                  isIconOnly
                  isDisabled={messageInput.trim().length === 0}
                  isLoading={pendingSend}
                  variant="flat"
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
        className={`pointer-events-auto relative z-10 rounded-full border border-[#d7b460] bg-[#e1be62] text-[#2f2406] shadow-none transition-colors hover:bg-[#d8b455] active:bg-[#cfa74a] ${
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
          <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11px] font-semibold text-black">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </Button>
    </div>
  );
};
