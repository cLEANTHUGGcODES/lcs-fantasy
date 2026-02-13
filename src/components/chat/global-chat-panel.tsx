"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Spinner } from "@heroui/spinner";
import { ChevronDown, ChevronLeft, MessageCircle, Send } from "lucide-react";
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
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatInputId = `global-chat-message-${currentUserId}`;
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

  const resizeChatInput = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = "0px";
    const nextHeight = Math.min(target.scrollHeight, 120);
    target.style.height = `${Math.max(40, nextHeight)}px`;
  }, []);

  const focusChatInput = useCallback(() => {
    const input = chatInputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    resizeChatInput(input);
  }, [resizeChatInput]);

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
        chatInputRef.current.style.height = "40px";
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
          className={`pointer-events-auto fixed inset-0 z-10 flex h-[100svh] min-h-[100svh] w-screen flex-col overflow-hidden overscroll-none rounded-none bg-gradient-to-b from-[#081120] via-[#0d1a30] to-[#111d33] text-slate-100 sm:relative sm:h-auto sm:min-h-0 sm:max-h-[min(700px,86dvh)] sm:w-[380px] sm:rounded-2xl sm:border sm:border-slate-400/45 sm:shadow-2xl sm:backdrop-blur-md ${className ?? ""}`}
        >
          <CardHeader
            className="flex items-center justify-between border-b border-slate-500/35 px-3 pb-1.5 pt-2"
            style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
          >
            <div>
              <h2 className="text-sm font-semibold text-white sm:text-base">Global Chat</h2>
              <p className="hidden text-[11px] text-slate-300 sm:block">
                Shared across dashboard and draft rooms
              </p>
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
          <CardBody className="flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:gap-3 sm:p-3">
            {loading ? (
              <div className="flex min-h-0 flex-1 items-center justify-center">
                <Spinner label="Loading chat..." />
              </div>
            ) : (
              <div
                ref={messageListRef}
                className="flex-1 min-h-0 space-y-1.5 overflow-y-auto overscroll-contain px-1 pb-1 touch-pan-y sm:space-y-2 sm:rounded-large sm:border sm:border-slate-500/35 sm:bg-[#070f1f]/75 sm:p-3"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {sortedMessages.length === 0 ? (
                  <p className="text-sm text-slate-300">No messages yet. Start the banter.</p>
                ) : (
                  sortedMessages.map((entry) => {
                    const isCurrentUser = entry.userId === currentUserId;
                    return (
                      <div
                        key={entry.id}
                        className={`flex ${isCurrentUser ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[82%] rounded-2xl border px-2.5 py-1.5 sm:max-w-[88%] sm:px-3 sm:py-2 ${
                            isCurrentUser
                              ? "border-blue-300/70 bg-blue-500/85 text-white shadow-[0_8px_20px_rgba(59,130,246,0.28)]"
                              : "border-slate-500/60 bg-slate-800/88 text-slate-100 shadow-[0_8px_18px_rgba(15,23,42,0.35)]"
                          }`}
                        >
                          <p className={`text-[10px] ${isCurrentUser ? "text-blue-100/90" : "text-slate-300"}`}>
                            <span className={`font-semibold ${isCurrentUser ? "text-white" : "text-slate-100"}`}>
                              {entry.senderLabel}
                            </span>{" "}
                            •{" "}
                            {formatTime(entry.createdAt)}
                          </p>
                          <p
                            className={`mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-5 sm:mt-1 sm:text-sm ${
                              isCurrentUser ? "text-white" : "text-slate-100"
                            }`}
                          >
                            {entry.message}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <div
              className="-mx-2.5 mt-auto border-t border-slate-500/35 bg-[#091426]/95 px-2.5 pt-1.5 sm:mx-0 sm:mt-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 0.35rem)" }}
            >
              <form
                autoComplete="off"
                className="flex items-end gap-2 rounded-large border border-slate-500/35 bg-slate-900/55 p-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitMessage();
                }}
              >
                <div className="flex-1">
                  <label className="sr-only" htmlFor={chatInputId}>
                    Chat message
                  </label>
                  <textarea
                    ref={chatInputRef}
                    aria-label="Chat message"
                    autoCapitalize="sentences"
                    autoComplete="off"
                    autoCorrect="on"
                    className="w-full min-h-[40px] max-h-[120px] resize-none rounded-xl border border-slate-500/45 bg-[#08111f] px-3 py-2 text-[13px] leading-5 text-slate-100 outline-none transition focus:border-primary-400/70 focus:ring-2 focus:ring-primary-400/30 sm:text-sm"
                    data-form-type="other"
                    data-lpignore="true"
                    disabled={pendingSend}
                    enterKeyHint="send"
                    id={chatInputId}
                    inputMode="text"
                    maxLength={MAX_GLOBAL_CHAT_MESSAGE_LENGTH}
                    name="chat_message"
                    placeholder="Message"
                    rows={1}
                    spellCheck
                    value={messageInput}
                    onChange={(event) => {
                      setMessageInput(event.target.value);
                      resizeChatInput(event.target);
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
                  color="primary"
                  isDisabled={messageInput.trim().length === 0}
                  isLoading={pendingSend}
                  type="submit"
                  variant="flat"
                >
                  <span className="inline-flex items-center gap-1">
                    <Send className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                    <span className="hidden sm:inline">Send</span>
                  </span>
                </Button>
              </form>
              <div className="mt-1 hidden items-center justify-end text-[11px] text-slate-300 sm:flex">
                {messageInput.trim().length}/{MAX_GLOBAL_CHAT_MESSAGE_LENGTH}
              </div>
              {error ? <p className="mt-1 text-sm text-danger-400">{error}</p> : null}
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Button
        className={`pointer-events-auto relative z-10 rounded-full border border-default-200/35 shadow-lg ${
          isOpen ? "hidden sm:inline-flex" : ""
        }`}
        color="primary"
        radius="full"
        variant="shadow"
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
