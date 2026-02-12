"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Input } from "@heroui/input";
import { Spinner } from "@heroui/spinner";
import { ChevronDown, MessageCircle, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { GlobalChatMessage } from "@/types/chat";

type GlobalChatResponse = {
  messages?: GlobalChatMessage[];
  message?: GlobalChatMessage;
  error?: string;
};

const MAX_GLOBAL_CHAT_MESSAGE_LENGTH = 320;

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
  const [messages, setMessages] = useState<GlobalChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [pendingSend, setPendingSend] = useState(false);
  const [hasInitializedUnreadState, setHasInitializedUnreadState] = useState(false);
  const [lastSeenMessageId, setLastSeenMessageId] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const sortedMessages = useMemo(
    () => [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages],
  );

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
    if (!isOpen) {
      return;
    }
    const el = messageListRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [isOpen, sortedMessages]);

  const submitMessage = useCallback(async () => {
    const trimmed = messageInput.replace(/\s+/g, " ").trim();
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
      await loadMessages();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to send chat message.");
    } finally {
      setPendingSend(false);
    }
  }, [loadMessages, messageInput]);

  useEffect(() => {
    const latestMessageId = sortedMessages[sortedMessages.length - 1]?.id ?? 0;
    if (!hasInitializedUnreadState) {
      setHasInitializedUnreadState(true);
      setLastSeenMessageId(latestMessageId);
      return;
    }

    if (isOpen) {
      if (lastSeenMessageId !== latestMessageId) {
        setLastSeenMessageId(latestMessageId);
      }
      if (unreadCount !== 0) {
        setUnreadCount(0);
      }
      return;
    }

    if (latestMessageId <= lastSeenMessageId) {
      return;
    }

    const nextUnreadCount = sortedMessages.filter(
      (entry) => entry.id > lastSeenMessageId && entry.userId !== currentUserId,
    ).length;
    setUnreadCount(nextUnreadCount);
  }, [
    currentUserId,
    hasInitializedUnreadState,
    isOpen,
    lastSeenMessageId,
    sortedMessages,
    unreadCount,
  ]);

  const openChat = () => {
    setIsOpen(true);
    const latestMessageId = sortedMessages[sortedMessages.length - 1]?.id ?? 0;
    setLastSeenMessageId(latestMessageId);
    setUnreadCount(0);
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
    <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex flex-col items-end gap-2">
      {isOpen ? (
        <button
          aria-label="Close chat"
          className="pointer-events-auto fixed inset-0 cursor-default bg-transparent"
          type="button"
          onClick={closeChat}
        />
      ) : null}

      {isOpen ? (
        <Card
          className={`pointer-events-auto relative z-10 w-[calc(100vw-1rem)] max-w-[380px] border border-slate-400/45 bg-gradient-to-b from-[#0a1220]/95 to-[#111d33]/95 text-slate-100 shadow-2xl backdrop-blur-md ${className ?? ""}`}
        >
          <CardHeader className="flex items-center justify-between border-b border-slate-500/35 pb-2 pt-3">
            <div>
              <h2 className="text-base font-semibold text-white">Global Chat</h2>
              <p className="text-[11px] text-slate-300">Shared across dashboard and draft rooms.</p>
            </div>
            <Button
              isIconOnly
              aria-label="Minimize chat"
              size="sm"
              variant="light"
              onPress={closeChat}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardBody className="space-y-3 p-3">
            {loading ? (
              <div className="flex h-[280px] items-center justify-center">
                <Spinner label="Loading chat..." />
              </div>
            ) : (
              <div
                ref={messageListRef}
                className="h-[280px] max-h-[58vh] space-y-2 overflow-y-auto rounded-large border border-slate-500/35 bg-[#070f1f]/75 p-3"
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
                          className={`max-w-[88%] rounded-2xl border px-3 py-2 ${
                            isCurrentUser
                              ? "border-blue-300/70 bg-blue-500/85 text-white shadow-[0_8px_20px_rgba(59,130,246,0.28)]"
                              : "border-slate-500/60 bg-slate-800/88 text-slate-100 shadow-[0_8px_18px_rgba(15,23,42,0.35)]"
                          }`}
                        >
                          <p className={`text-[11px] ${isCurrentUser ? "text-blue-100/90" : "text-slate-300"}`}>
                            <span className={`font-semibold ${isCurrentUser ? "text-white" : "text-slate-100"}`}>
                              {entry.senderLabel}
                            </span>{" "}
                            •{" "}
                            {formatTime(entry.createdAt)}
                          </p>
                          <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${isCurrentUser ? "text-white" : "text-slate-100"}`}>
                            {entry.message}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <form
              className="flex items-center gap-2 rounded-large border border-slate-500/35 bg-slate-900/45 p-2"
              onSubmit={(event) => {
                event.preventDefault();
                void submitMessage();
              }}
            >
              <Input
                aria-label="Chat message"
                isDisabled={pendingSend}
                maxLength={MAX_GLOBAL_CHAT_MESSAGE_LENGTH}
                placeholder="Type your message..."
                value={messageInput}
                variant="bordered"
                onValueChange={setMessageInput}
              />
              <Button
                color="primary"
                isDisabled={messageInput.trim().length === 0}
                isLoading={pendingSend}
                type="submit"
                variant="flat"
              >
                <span className="inline-flex items-center gap-1">
                  <Send className="h-4 w-4" />
                  Send
                </span>
              </Button>
            </form>
            <div className="flex items-center justify-end text-[11px] text-slate-300">
              {messageInput.trim().length}/{MAX_GLOBAL_CHAT_MESSAGE_LENGTH}
            </div>
            {error ? <p className="text-sm text-danger-400">{error}</p> : null}
          </CardBody>
        </Card>
      ) : null}

      <Button
        className="pointer-events-auto relative z-10 rounded-full border border-default-200/35 shadow-lg"
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
