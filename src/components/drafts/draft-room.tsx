"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Spinner } from "@heroui/spinner";
import { Tab, Tabs } from "@heroui/tabs";
import { Tooltip } from "@heroui/tooltip";
import {
  ClipboardList,
  CircleCheckBig,
  Clock3,
  Gauge,
  GripVertical,
  Pause,
  Play,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  SkipForward,
  SquareCheckBig,
  Table,
  TableProperties,
  Target,
  UserCheck,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { DraftDetail, DraftParticipant, DraftStatus } from "@/types/draft";

type DraftDetailResponse = {
  draft?: DraftDetail;
  error?: string;
};

const statusColor = (status: DraftStatus) => {
  if (status === "live") {
    return "success";
  }
  if (status === "paused") {
    return "warning";
  }
  if (status === "completed") {
    return "secondary";
  }
  return "default";
};

const formatDate = (value: string | null): string =>
  value ? new Date(value).toLocaleString() : "N/A";

const formatCountdown = (targetIso: string | null, nowMs: number): string => {
  if (!targetIso) {
    return "N/A";
  }

  const target = new Date(targetIso).getTime();
  const deltaSeconds = Math.max(0, Math.floor((target - nowMs) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const seconds = deltaSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
};

const boardPickForSlot = ({
  participants,
  picksByOverallPick,
  roundNumber,
  participantIndex,
}: {
  participants: DraftParticipant[];
  picksByOverallPick: Map<number, DraftDetail["picks"][number]>;
  roundNumber: number;
  participantIndex: number;
}) => {
  const participantCount = participants.length;
  const pickWithinRound =
    roundNumber % 2 === 1 ? participantCount - participantIndex : participantIndex + 1;
  const overallPick = (roundNumber - 1) * participantCount + pickWithinRound;
  return picksByOverallPick.get(overallPick) ?? null;
};

const PRIMARY_ROLE_FILTERS = ["TOP", "JNG", "MID", "ADC", "SUP", "FLEX"] as const;
const UNASSIGNED_ROLE = "UNASSIGNED";
const LOL_FANDOM_ROLE_ICONS: Record<string, string> = {
  TOP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/4/44/Toprole_icon.png/revision/latest",
  JNG: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/f/fb/Junglerole_icon.png/revision/latest",
  MID: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/c/ce/Midrole_icon.png/revision/latest",
  ADC: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/d/d1/AD_Carryrole_icon.png/revision/latest",
  SUP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/7/73/Supportrole_icon.png/revision/latest",
};

const normalizeRole = (role: string | null): string => {
  const value = role?.trim().toUpperCase();
  if (!value) {
    return UNASSIGNED_ROLE;
  }
  return value;
};

const formatRoleLabel = (role: string | null): string => {
  const normalized = normalizeRole(role);
  return normalized === UNASSIGNED_ROLE ? "N/A" : normalized;
};

const roleIconUrl = (role: string | null): string | null => {
  const normalized = normalizeRole(role);
  return LOL_FANDOM_ROLE_ICONS[normalized] ?? null;
};

const roleChipClassName = (role: string | null): string => {
  const normalized = normalizeRole(role);
  if (normalized === "TOP") {
    return "border border-rose-300/70 bg-rose-100 text-rose-800 dark:border-rose-300/40 dark:bg-rose-500/20 dark:text-rose-200";
  }
  if (normalized === "JNG") {
    return "border border-emerald-300/70 bg-emerald-100 text-emerald-800 dark:border-emerald-300/40 dark:bg-emerald-500/20 dark:text-emerald-200";
  }
  if (normalized === "MID") {
    return "border border-amber-300/70 bg-amber-100 text-amber-900 dark:border-amber-300/40 dark:bg-amber-500/20 dark:text-amber-100";
  }
  if (normalized === "ADC") {
    return "border border-violet-300/70 bg-violet-100 text-violet-800 dark:border-violet-300/40 dark:bg-violet-500/20 dark:text-violet-200";
  }
  if (normalized === "SUP") {
    return "border border-pink-300/70 bg-pink-100 text-pink-800 dark:border-pink-300/40 dark:bg-pink-500/20 dark:text-pink-200";
  }
  return "border border-default-300/70 bg-default-100 text-default-700 dark:border-default-300/40 dark:bg-default-500/20 dark:text-default-200";
};

export const DraftRoom = ({
  draftId,
  currentUserId,
  currentUserLabel,
}: {
  draftId: number;
  currentUserId: string;
  currentUserLabel: string;
}) => {
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [statusAction, setStatusAction] = useState<string | null>(null);
  const [pickPending, setPickPending] = useState(false);
  const [readyPending, setReadyPending] = useState(false);
  const [pickQueue, setPickQueue] = useState<string[]>([]);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [clientNowMs, setClientNowMs] = useState(() => Date.now());

  const applyDraft = useCallback((nextDraft: DraftDetail) => {
    setDraft(nextDraft);
    const serverNowMs = new Date(nextDraft.serverNow).getTime();
    if (Number.isFinite(serverNowMs)) {
      setServerOffsetMs(serverNowMs - Date.now());
    }
  }, []);

  const loadDraft = useCallback(async () => {
    const response = await fetch(`/api/drafts/${draftId}`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as DraftDetailResponse;

    if (!response.ok || !payload.draft) {
      throw new Error(payload.error ?? "Unable to load draft.");
    }

    applyDraft(payload.draft);
  }, [applyDraft, draftId]);
  const draftStatus = draft?.status ?? null;

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        await loadDraft();
      } catch (loadError) {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load draft.");
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
  }, [loadDraft]);

  useEffect(() => {
    if (!draftStatus) {
      return;
    }
    const intervalMs = draftStatus === "live" ? 3000 : draftStatus === "scheduled" ? 5000 : 10000;
    const id = window.setInterval(() => {
      void loadDraft().catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [draftStatus, loadDraft]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`draft-room-${draftId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fantasy_drafts",
          filter: `id=eq.${draftId}`,
        },
        () => {
          void loadDraft().catch(() => undefined);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fantasy_draft_picks",
          filter: `draft_id=eq.${draftId}`,
        },
        () => {
          void loadDraft().catch(() => undefined);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "fantasy_draft_presence",
          filter: `draft_id=eq.${draftId}`,
        },
        () => {
          void loadDraft().catch(() => undefined);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [draftId, loadDraft]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setClientNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const sendPresence = useCallback(
    async ({ ready }: { ready?: boolean } = {}) => {
      const response = await fetch(`/api/drafts/${draftId}/presence`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(typeof ready === "boolean" ? { ready } : {}),
      });

      const payload = (await response.json()) as DraftDetailResponse;
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Unable to update presence.");
      }

      applyDraft(payload.draft);
    },
    [applyDraft, draftId],
  );

  const isCurrentUserParticipant = Boolean(
    draft?.participantPresence.some((entry) => entry.userId === currentUserId),
  );

  useEffect(() => {
    if (!isCurrentUserParticipant || draftStatus === "completed" || !draftStatus) {
      return;
    }

    const heartbeat = () => {
      void sendPresence().catch(() => undefined);
    };

    heartbeat();
    const id = window.setInterval(heartbeat, 15000);
    return () => window.clearInterval(id);
  }, [draftStatus, isCurrentUserParticipant, sendPresence]);

  const picksByOverallPick = useMemo(
    () => new Map((draft?.picks ?? []).map((pick) => [pick.overallPick, pick])),
    [draft],
  );
  const presenceByUserId = useMemo(
    () => new Map((draft?.participantPresence ?? []).map((entry) => [entry.userId, entry])),
    [draft],
  );
  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const player of draft?.availablePlayers ?? []) {
      const normalizedRole = normalizeRole(player.playerRole);
      counts.set(normalizedRole, (counts.get(normalizedRole) ?? 0) + 1);
    }
    return counts;
  }, [draft?.availablePlayers]);
  const roleFilters = useMemo(
    () => [
      {
        value: "ALL",
        label: "All",
        count: draft?.availablePlayers.length ?? 0,
      },
      ...PRIMARY_ROLE_FILTERS.map((role) => ({
        value: role,
        label: role,
        count: roleCounts.get(role) ?? 0,
      })),
      ...(roleCounts.get(UNASSIGNED_ROLE)
        ? [
            {
              value: UNASSIGNED_ROLE,
              label: "N/A",
              count: roleCounts.get(UNASSIGNED_ROLE) ?? 0,
            },
          ]
        : []),
    ],
    [draft?.availablePlayers.length, roleCounts],
  );
  const filteredAvailablePlayers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return (draft?.availablePlayers ?? []).filter((player) => {
      const matchesRole =
        roleFilter === "ALL" ? true : normalizeRole(player.playerRole) === roleFilter;

      if (!matchesRole) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const roleLabel = formatRoleLabel(player.playerRole).toLowerCase();
      return (
        player.playerName.toLowerCase().includes(normalizedSearch) ||
        (player.playerTeam ?? "").toLowerCase().includes(normalizedSearch) ||
        roleLabel.includes(normalizedSearch)
      );
    });
  }, [draft?.availablePlayers, roleFilter, searchTerm]);

  const onClockUserId = draft?.nextPick?.participantUserId ?? null;
  const canCurrentUserPick =
    Boolean(draft?.status === "live") &&
    Boolean(draft?.nextPick) &&
    (onClockUserId === currentUserId || draft?.isCommissioner);
  const effectiveNowMs = clientNowMs + serverOffsetMs;
  const currentPresence = presenceByUserId.get(currentUserId) ?? null;
  const participantsByPosition = useMemo(
    () => [...(draft?.participants ?? [])].sort((a, b) => a.draftPosition - b.draftPosition),
    [draft?.participants],
  );
  const availablePlayersByName = useMemo(
    () => new Map((draft?.availablePlayers ?? []).map((player) => [player.playerName, player])),
    [draft?.availablePlayers],
  );
  const queuedPlayers = useMemo(
    () =>
      pickQueue
        .map((name) => availablePlayersByName.get(name))
        .filter((player): player is DraftDetail["availablePlayers"][number] => Boolean(player)),
    [availablePlayersByName, pickQueue],
  );
  const nextQueuedPlayerName = pickQueue[0] ?? null;

  useEffect(() => {
    const availableNames = new Set((draft?.availablePlayers ?? []).map((player) => player.playerName));
    setPickQueue((prevQueue) => {
      const nextQueue = prevQueue.filter((playerName) => availableNames.has(playerName));
      return nextQueue.length === prevQueue.length ? prevQueue : nextQueue;
    });
  }, [draft?.availablePlayers]);

  useEffect(() => {
    if (roleFilter === "ALL") {
      return;
    }
    const isStandardFilter = PRIMARY_ROLE_FILTERS.includes(
      roleFilter as (typeof PRIMARY_ROLE_FILTERS)[number],
    );
    if (!isStandardFilter && !roleCounts.has(roleFilter)) {
      setRoleFilter("ALL");
    }
  }, [roleCounts, roleFilter]);

  const updateDraftStatus = async (
    status: DraftStatus,
    { force = false, actionKey }: { force?: boolean; actionKey?: string } = {},
  ) => {
    if (!draft) {
      return;
    }
    setStatusPending(true);
    setStatusAction(actionKey ?? null);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draft.id}/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ status, force }),
      });

      const payload = (await response.json()) as DraftDetailResponse;
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Unable to update draft status.");
      }
      applyDraft(payload.draft);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update status.");
    } finally {
      setStatusPending(false);
      setStatusAction(null);
    }
  };

  const submitPick = async () => {
    if (!draft || !nextQueuedPlayerName) {
      return;
    }
    setPickPending(true);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draft.id}/pick`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ playerName: nextQueuedPlayerName }),
      });
      const payload = (await response.json()) as DraftDetailResponse;
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Unable to submit pick.");
      }
      applyDraft(payload.draft);
      setPickQueue((prevQueue) => prevQueue.slice(1));
    } catch (pickError) {
      setError(pickError instanceof Error ? pickError.message : "Unable to submit pick.");
    } finally {
      setPickPending(false);
    }
  };

  const addPlayerToQueue = (playerName: string) => {
    setPickQueue((prevQueue) => {
      if (prevQueue.includes(playerName)) {
        return prevQueue;
      }
      return [...prevQueue, playerName];
    });
  };

  const removePlayerFromQueue = (playerName: string) => {
    setPickQueue((prevQueue) => prevQueue.filter((queuedName) => queuedName !== playerName));
  };

  const clearQueue = () => {
    setPickQueue([]);
  };

  const moveQueueItem = (fromIndex: number, toIndex: number) => {
    setPickQueue((prevQueue) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prevQueue.length ||
        toIndex >= prevQueue.length ||
        fromIndex === toIndex
      ) {
        return prevQueue;
      }
      const nextQueue = [...prevQueue];
      const [movedPlayer] = nextQueue.splice(fromIndex, 1);
      nextQueue.splice(toIndex, 0, movedPlayer);
      return nextQueue;
    });
  };

  const toggleReady = async () => {
    if (!draft || !isCurrentUserParticipant || !currentPresence) {
      return;
    }

    setReadyPending(true);
    setError(null);
    try {
      await sendPresence({ ready: !currentPresence.isReady });
    } catch (presenceError) {
      setError(presenceError instanceof Error ? presenceError.message : "Unable to update readiness.");
    } finally {
      setReadyPending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[280px] items-center justify-center">
        <Spinner label="Loading draft room..." />
      </div>
    );
  }

  if (!draft) {
    return (
      <Card className="border border-danger-300/40 bg-danger-50/5">
        <CardHeader>
          <h1 className="text-xl font-semibold">Draft Unavailable</h1>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-default-500">{error ?? "Draft not found."}</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <section className="space-y-5">
      <Card className="border border-primary-400/35 bg-gradient-to-br from-content1 via-content1 to-content2/45 shadow-sm">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold">{draft.name}</h1>
            <p className="text-sm text-default-500">
              {draft.leagueSlug} {draft.seasonYear} • Source {draft.sourcePage}
            </p>
            <p className="text-xs text-default-500">
              Commissioner: {draft.createdByLabel ?? draft.createdByUserId}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip color={statusColor(draft.status)} variant="flat">
              {draft.status}
            </Chip>
            <Chip variant="flat">
              Picks {draft.pickCount}/{draft.totalPickCount}
            </Chip>
            <Chip color={canCurrentUserPick ? "success" : "default"} variant="flat">
              <span className="inline-flex items-center gap-1">
                <Clock3 className="h-3.5 w-3.5" />
                {canCurrentUserPick ? "You are on the clock" : "Waiting for your turn"}
              </span>
            </Chip>
          </div>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-2 text-sm text-default-600 md:grid-cols-2">
          <p>Scheduled: {formatDate(draft.scheduledAt)}</p>
          <p>Started: {formatDate(draft.startedAt)}</p>
          <p>
            Timer: {draft.pickSeconds}s per pick • Rounds: {draft.roundCount} • Players:{" "}
            {draft.participantCount}
          </p>
          <p>
            Lobby: {draft.presentParticipantCount}/{draft.participantCount} present •{" "}
            {draft.readyParticipantCount}/{draft.participantCount} ready
          </p>
          {draft.nextPick ? (
            <p className="font-medium text-default-300 md:col-span-2">
              On clock: {draft.nextPick.participantDisplayName} (Pick #{draft.nextPick.overallPick}
              , Round {draft.nextPick.roundNumber})
            </p>
          ) : (
            <p className="font-medium text-default-300 md:col-span-2">Draft board is complete.</p>
          )}
          <p className="md:col-span-2">
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" />
              Current pick countdown:{" "}
              {formatCountdown(draft.currentPickDeadlineAt, effectiveNowMs)} • You are{" "}
              {currentUserLabel}
            </span>
          </p>
          {error ? <p className="text-sm text-danger-400 md:col-span-2">{error}</p> : null}
        </CardBody>
      </Card>

      <Card className="border border-default-200/40 bg-content1/75">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UserCheck className="h-5 w-5 text-primary" />
            Lobby Status
          </h2>
          <Chip color={draft.allParticipantsReady ? "success" : "default"} variant="flat">
            {draft.readyParticipantCount}/{draft.participantCount} ready
          </Chip>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-large border border-default-200/40 bg-content2/45 p-3">
              <p className="text-xs uppercase tracking-wide text-default-500">You</p>
              <p className="mt-1 text-sm font-semibold">{currentUserLabel}</p>
              {isCurrentUserParticipant ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Chip color={currentPresence?.isOnline ? "success" : "default"} size="sm" variant="flat">
                    <span className="inline-flex items-center gap-1">
                      {currentPresence?.isOnline ? (
                        <Wifi className="h-3.5 w-3.5" />
                      ) : (
                        <WifiOff className="h-3.5 w-3.5" />
                      )}
                      {currentPresence?.isOnline ? "Online" : "Offline"}
                    </span>
                  </Chip>
                  <Chip color={currentPresence?.isReady ? "primary" : "default"} size="sm" variant="flat">
                    <span className="inline-flex items-center gap-1">
                      <SquareCheckBig className="h-3.5 w-3.5" />
                      {currentPresence?.isReady ? "Ready" : "Not Ready"}
                    </span>
                  </Chip>
                </div>
              ) : (
                <p className="mt-2 text-xs text-default-500">
                  You are currently spectating this room.
                </p>
              )}
            </div>

            <div className="rounded-large border border-default-200/40 bg-content2/45 p-3">
              <p className="text-xs uppercase tracking-wide text-default-500">Your Action</p>
              {isCurrentUserParticipant ? (
                <>
                  <Button
                    className="mt-2 w-full"
                    color={currentPresence?.isReady ? "warning" : "primary"}
                    isDisabled={draft.status === "completed"}
                    isLoading={readyPending}
                    size="sm"
                    startContent={
                      currentPresence?.isReady ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <CircleCheckBig className="h-4 w-4" />
                      )
                    }
                    variant="flat"
                    onPress={() => void toggleReady()}
                  >
                    {currentPresence?.isReady ? "Set Not Ready" : "Mark Ready"}
                  </Button>
                  <p className="mt-2 text-xs text-default-500">
                    Mark ready before the scheduled start so the commissioner can launch cleanly.
                  </p>
                </>
              ) : (
                <p className="mt-2 text-xs text-default-500">
                  Only registered participants can update lobby readiness.
                </p>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-large border border-default-200/40 bg-content2/45">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead className="bg-content2/80 text-xs uppercase tracking-wide text-default-500">
                <tr>
                  <th className="w-20 px-3 py-2 font-medium">Slot</th>
                  <th className="px-3 py-2 font-medium">Player</th>
                  <th className="w-36 px-3 py-2 font-medium">Status</th>
                  <th className="w-36 px-3 py-2 font-medium">Ready</th>
                </tr>
              </thead>
              <tbody>
                {participantsByPosition.map((entry) => {
                  const presence = presenceByUserId.get(entry.userId);
                  const isCurrentUserRow = entry.userId === currentUserId;
                  return (
                    <tr
                      key={entry.id}
                      className={`border-t border-default-200/30 ${
                        isCurrentUserRow ? "bg-primary-500/10" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5 text-sm font-semibold text-default-600">
                        #{entry.draftPosition}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{entry.displayName}</span>
                          {isCurrentUserRow ? (
                            <Chip color="primary" size="sm" variant="flat">
                              You
                            </Chip>
                          ) : null}
                        </div>
                        <p className="text-xs text-default-500">
                          Team: {entry.teamName ?? "Not set"}
                        </p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Chip
                          color={presence?.isOnline ? "success" : "default"}
                          size="sm"
                          variant="flat"
                        >
                          <span className="inline-flex items-center gap-1">
                            {presence?.isOnline ? (
                              <Wifi className="h-3.5 w-3.5" />
                            ) : (
                              <WifiOff className="h-3.5 w-3.5" />
                            )}
                            {presence?.isOnline ? "Online" : "Offline"}
                          </span>
                        </Chip>
                      </td>
                      <td className="px-3 py-2.5">
                        <Chip
                          color={presence?.isReady ? "primary" : "default"}
                          size="sm"
                          variant="flat"
                        >
                          <span className="inline-flex items-center gap-1">
                            <SquareCheckBig className="h-3.5 w-3.5" />
                            {presence?.isReady ? "Ready" : "Not Ready"}
                          </span>
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {draft.isCommissioner ? (
        <Card className="border border-default-200/40 bg-content1/75">
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Shield className="h-5 w-5 text-warning" />
              Commissioner Controls
            </h2>
            <Chip variant="flat">
              Status: <span className="ml-1 font-semibold">{draft.status}</span>
            </Chip>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="rounded-medium border border-default-200/40 bg-content2/40 px-3 py-2">
              <p className="inline-flex items-center gap-1 text-xs text-default-500">
                <Gauge className="h-3.5 w-3.5" />
                Use the icon control bar for draft state changes.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              <div className="flex flex-col items-center gap-1">
                <Tooltip content="Start draft (all participants present and ready)">
                  <span>
                    <Button
                      isIconOnly
                      color="success"
                      isDisabled={
                        statusPending ||
                        draft.status !== "scheduled" ||
                        !draft.allParticipantsPresent ||
                        !draft.allParticipantsReady
                      }
                      isLoading={statusAction === "start"}
                      radius="full"
                      size="sm"
                      variant="flat"
                      onPress={() => void updateDraftStatus("live", { actionKey: "start" })}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                  </span>
                </Tooltip>
                <span className="text-[11px] text-default-500">Start</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <Tooltip content="Force start draft even if lobby checks are incomplete">
                  <span>
                    <Button
                      isIconOnly
                      color="danger"
                      isDisabled={
                        statusPending ||
                        draft.status !== "scheduled" ||
                        (draft.allParticipantsPresent && draft.allParticipantsReady)
                      }
                      isLoading={statusAction === "force-start"}
                      radius="full"
                      size="sm"
                      variant="flat"
                      onPress={() =>
                        void updateDraftStatus("live", { force: true, actionKey: "force-start" })
                      }
                    >
                      <ShieldAlert className="h-4 w-4" />
                    </Button>
                  </span>
                </Tooltip>
                <span className="text-[11px] text-default-500">Force</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <Tooltip content="Pause live draft">
                  <span>
                    <Button
                      isIconOnly
                      color="warning"
                      isDisabled={statusPending || draft.status !== "live"}
                      isLoading={statusAction === "pause"}
                      radius="full"
                      size="sm"
                      variant="flat"
                      onPress={() => void updateDraftStatus("paused", { actionKey: "pause" })}
                    >
                      <Pause className="h-4 w-4" />
                    </Button>
                  </span>
                </Tooltip>
                <span className="text-[11px] text-default-500">Pause</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <Tooltip content="Resume paused draft">
                  <span>
                    <Button
                      isIconOnly
                      color="primary"
                      isDisabled={statusPending || draft.status !== "paused"}
                      isLoading={statusAction === "resume"}
                      radius="full"
                      size="sm"
                      variant="flat"
                      onPress={() =>
                        void updateDraftStatus("live", { force: true, actionKey: "resume" })
                      }
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </span>
                </Tooltip>
                <span className="text-[11px] text-default-500">Resume</span>
              </div>

              <div className="flex flex-col items-center gap-1">
                <Tooltip content="Complete draft and lock board">
                  <span>
                    <Button
                      isIconOnly
                      color="secondary"
                      isDisabled={statusPending || draft.status === "completed"}
                      isLoading={statusAction === "complete"}
                      radius="full"
                      size="sm"
                      variant="flat"
                      onPress={() =>
                        void updateDraftStatus("completed", { actionKey: "complete" })
                      }
                    >
                      <SquareCheckBig className="h-4 w-4" />
                    </Button>
                  </span>
                </Tooltip>
                <span className="text-[11px] text-default-500">Complete</span>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden border border-primary-400/30 bg-content1/80 shadow-sm">
          <CardHeader className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Table className="h-5 w-5 text-primary" />
                  Available Players
                </h2>
                <p className="text-xs text-default-500">
                  Use filters to narrow the board, then select from the table.
                </p>
              </div>
              <Chip variant="flat">
                Showing {filteredAvailablePlayers.length} / {draft.availablePlayers.length}
              </Chip>
            </div>
            <Tabs
              aria-label="Position filter"
              className="w-full"
              color="primary"
              selectedKey={roleFilter}
              size="sm"
              variant="underlined"
              onSelectionChange={(key) => setRoleFilter(String(key))}
            >
              {roleFilters.map((filter) => (
                <Tab
                  key={filter.value}
                  isDisabled={filter.value !== "ALL" && filter.count === 0}
                  title={(
                    <span className="inline-flex items-center gap-1.5">
                      {roleIconUrl(filter.value) ? (
                        <Image
                          alt={`${filter.label} role icon`}
                          className="h-4 w-4"
                          height={16}
                          src={roleIconUrl(filter.value)!}
                          width={16}
                        />
                      ) : null}
                      <span>
                        {filter.label} ({filter.count})
                      </span>
                    </span>
                  )}
                />
              ))}
            </Tabs>
          </CardHeader>
          <CardBody className="space-y-3">
            <Input
              label="Search"
              labelPlacement="outside"
              placeholder="Search player, team, or role"
              size="sm"
              startContent={<Search className="h-4 w-4 text-default-500" />}
              value={searchTerm}
              onValueChange={setSearchTerm}
            />

            <div className="overflow-hidden rounded-large border border-default-200/40 bg-content2/45">
              <div className="max-h-[29rem] overflow-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-content2/95 text-xs uppercase tracking-wide text-default-500 backdrop-blur">
                    <tr>
                      <th className="px-3 py-2 font-medium">Queued</th>
                      <th className="px-3 py-2 font-medium">Player</th>
                      <th className="px-3 py-2 font-medium">Team</th>
                      <th className="px-3 py-2 font-medium">Position</th>
                      <th className="px-3 py-2 font-medium">Queue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAvailablePlayers.length === 0 ? (
                      <tr>
                        <td className="px-3 py-5 text-center text-default-500" colSpan={5}>
                          No players match this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredAvailablePlayers.map((player) => {
                        const isQueued = pickQueue.includes(player.playerName);
                        return (
                          <tr
                            key={player.id}
                            className={`border-t border-default-200/30 transition ${
                              isQueued ? "bg-primary-500/15" : "hover:bg-default-100/40"
                            }`}
                          >
                            <td className="px-3 py-3">
                              <div
                                className={`h-2.5 w-2.5 rounded-full ${
                                  isQueued ? "bg-primary" : "bg-default-300"
                                }`}
                              />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex items-center gap-2">
                                {player.teamIconUrl ? (
                                  <Image
                                    alt={`${player.playerName} team logo`}
                                    className="h-5 w-auto object-contain"
                                    height={20}
                                    src={player.teamIconUrl}
                                    width={48}
                                  />
                                ) : null}
                                <span className="font-medium">{player.playerName}</span>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-default-600">{player.playerTeam ?? "—"}</td>
                            <td className="px-3 py-3">
                              <Chip
                                className={roleChipClassName(player.playerRole)}
                                color="default"
                                size="sm"
                                variant="flat"
                              >
                                <span className="inline-flex items-center gap-1">
                                  {roleIconUrl(player.playerRole) ? (
                                    <Image
                                      alt={`${formatRoleLabel(player.playerRole)} role icon`}
                                      className="h-3.5 w-3.5"
                                      height={14}
                                      src={roleIconUrl(player.playerRole)!}
                                      width={14}
                                    />
                                  ) : null}
                                  {formatRoleLabel(player.playerRole)}
                                </span>
                              </Chip>
                            </td>
                            <td className="px-3 py-3">
                              <Button
                                aria-label={
                                  isQueued
                                    ? `${player.playerName} already in queue`
                                    : `Add ${player.playerName} to queue`
                                }
                                color={isQueued ? "primary" : "default"}
                                isDisabled={isQueued}
                                isIconOnly
                                size="sm"
                                variant="flat"
                                onPress={() => addPlayerToQueue(player.playerName)}
                              >
                                {isQueued ? (
                                  <CircleCheckBig className="h-4 w-4" />
                                ) : (
                                  <Plus className="h-4 w-4" />
                                )}
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card className="border border-default-200/40 bg-content1/80 shadow-sm">
          <CardHeader className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Pick Queue</h2>
              <p className="text-xs text-default-500">Drag to reorder. Top player submits first.</p>
            </div>
            <Button
              isDisabled={pickQueue.length === 0}
              size="sm"
              variant="light"
              onPress={clearQueue}
            >
              Clear Queue
            </Button>
          </CardHeader>
          <CardBody className="flex min-h-[32rem] flex-col gap-3">
            {queuedPlayers.length === 0 ? (
              <div className="flex min-h-[16rem] items-center justify-center rounded-large border border-dashed border-default-300/50 bg-content2/35 px-4">
                <p className="text-center text-sm text-default-500">
                  Add players with the + button to build your queue.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto rounded-large border border-default-200/40 bg-content2/45">
                <ul className="divide-y divide-default-200/30">
                  {queuedPlayers.map((player, index) => (
                    <li
                      key={player.playerName}
                      className={`flex items-center gap-2 px-3 py-2 ${
                        index === 0 ? "bg-primary-500/10" : ""
                      }`}
                      draggable
                      onDragEnd={() => setDraggedQueueIndex(null)}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDragStart={() => setDraggedQueueIndex(index)}
                      onDrop={() => {
                        if (draggedQueueIndex === null) {
                          return;
                        }
                        moveQueueItem(draggedQueueIndex, index);
                        setDraggedQueueIndex(null);
                      }}
                    >
                      <span className="text-xs font-semibold text-default-500">
                        {index + 1}.
                      </span>
                      <GripVertical className="h-4 w-4 shrink-0 text-default-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{player.playerName}</p>
                        <p className="truncate text-xs text-default-500">
                          {[player.playerTeam, formatRoleLabel(player.playerRole)]
                            .filter(Boolean)
                            .join(" • ")}
                        </p>
                      </div>
                      <Button
                        aria-label={`Remove ${player.playerName} from queue`}
                        isIconOnly
                        size="sm"
                        variant="light"
                        onPress={() => removePlayerFromQueue(player.playerName)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              className="w-full"
              color="primary"
              isDisabled={!nextQueuedPlayerName || !canCurrentUserPick}
              isLoading={pickPending}
              onPress={() => void submitPick()}
            >
              {canCurrentUserPick
                ? nextQueuedPlayerName
                  ? `Submit #1: ${nextQueuedPlayerName}`
                  : "Submit Pick"
                : "Waiting For Your Turn"}
            </Button>
            {!canCurrentUserPick ? (
              <p className="text-xs text-default-500">
                You can queue players now, but only submit when you are on the clock.
              </p>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <Card className="border border-default-200/40 bg-content1/75">
          <CardHeader>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Target className="h-5 w-5 text-primary" />
              Player Pool Snapshot
            </h2>
          </CardHeader>
          <CardBody className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {roleFilters
                .filter((filter) => filter.value !== "ALL" && filter.count > 0)
                .map((filter) => (
                  <div
                    key={filter.value}
                    className="rounded-medium border border-default-200/40 bg-content2/40 px-3 py-2"
                  >
                    <p className="inline-flex items-center gap-1 text-xs text-default-500">
                      {roleIconUrl(filter.value) ? (
                        <Image
                          alt={`${filter.label} role icon`}
                          className="h-3.5 w-3.5"
                          height={14}
                          src={roleIconUrl(filter.value)!}
                          width={14}
                        />
                      ) : null}
                      {filter.label}
                    </p>
                    <p className="text-base font-semibold">{filter.count}</p>
                  </div>
                ))}
            </div>
            <div className="rounded-medium border border-default-200/40 bg-content2/40 px-3 py-2 text-sm">
              <p>
                Remaining players:{" "}
                <span className="font-semibold">{draft.availablePlayers.length}</span>
              </p>
              <p>
                Current filter: <span className="font-semibold">{roleFilter}</span>
              </p>
              <p>
                Search matches: <span className="font-semibold">{filteredAvailablePlayers.length}</span>
              </p>
            </div>
            <div className="rounded-medium border border-default-200/40 bg-content2/40 px-3 py-2 text-sm">
              <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-default-500">
                <Clock3 className="h-3.5 w-3.5" />
                On Deck
              </p>
              {draft.nextPick ? (
                <p className="mt-1 font-medium">
                  Pick #{draft.nextPick.overallPick} • {draft.nextPick.participantDisplayName}
                </p>
              ) : (
                <p className="mt-1 text-default-500">Draft complete.</p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      <Card className="border border-default-200/40 bg-content1/75">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <TableProperties className="h-5 w-5 text-primary" />
            Reverse-Snake Draft Board
          </h2>
          <Chip variant="flat">
            Picks {draft.pickCount}/{draft.totalPickCount}
          </Chip>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="rounded-large border border-default-200/40 bg-content2/35 p-3 sm:p-4">
            <div className="space-y-4">
              {Array.from({ length: draft.roundCount }, (_, roundOffset) => {
                const roundNumber = roundOffset + 1;
                return (
                  <section
                    key={roundNumber}
                    className={roundNumber === 1 ? "" : "border-t border-default-200/30 pt-4"}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Round {roundNumber}</p>
                      <p className="text-xs text-default-500">
                        {roundNumber % 2 === 1
                          ? "Snake: high to low slot"
                          : "Snake: low to high slot"}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                      {draft.participants.map((entry, participantIndex) => {
                        const pick = boardPickForSlot({
                          participants: draft.participants,
                          picksByOverallPick,
                          roundNumber,
                          participantIndex,
                        });
                        const isOnDeck =
                          !pick &&
                          draft.nextPick?.roundNumber === roundNumber &&
                          draft.nextPick.participantUserId === entry.userId;

                        return (
                          <Card
                            key={`${entry.id}-${roundNumber}`}
                            className={`aspect-square border ${
                              isOnDeck
                                ? "border-primary-400/60 bg-primary-500/10"
                                : "border-default-200/35 bg-content1/65"
                            }`}
                          >
                            <CardBody className="flex h-full flex-col justify-between p-2">
                              <p className="truncate text-[11px] text-default-500">
                                #{entry.draftPosition} {entry.displayName}
                              </p>
                              {pick ? (
                                <>
                                  <div className="space-y-0.5">
                                    <p className="truncate text-xs font-semibold">{pick.playerName}</p>
                                    <p className="truncate text-[11px] text-default-500">
                                      #{pick.overallPick}
                                      {pick.playerTeam ? ` • ${pick.playerTeam}` : ""}
                                    </p>
                                  </div>
                                  <div>
                                    {pick.playerRole ? (
                                      <Chip
                                        className={roleChipClassName(pick.playerRole)}
                                        color="default"
                                        size="sm"
                                        variant="flat"
                                      >
                                        <span className="inline-flex items-center gap-1">
                                          {roleIconUrl(pick.playerRole) ? (
                                            <Image
                                              alt={`${formatRoleLabel(pick.playerRole)} role icon`}
                                              className="h-3 w-3"
                                              height={12}
                                              src={roleIconUrl(pick.playerRole)!}
                                              width={12}
                                            />
                                          ) : null}
                                          {formatRoleLabel(pick.playerRole)}
                                        </span>
                                      </Chip>
                                    ) : null}
                                  </div>
                                </>
                              ) : (
                                <p
                                  className={`text-[11px] ${
                                    isOnDeck
                                      ? "font-medium text-primary-600 dark:text-primary-300"
                                      : "text-default-500"
                                  }`}
                                >
                                  {isOnDeck ? "On deck" : "Open slot"}
                                </p>
                              )}
                            </CardBody>
                          </Card>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="border border-default-200/40 bg-content1/75">
        <CardHeader>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <ClipboardList className="h-5 w-5 text-primary" />
            Pick Log
          </h2>
        </CardHeader>
        <CardBody className="space-y-2">
          {draft.picks.length === 0 ? (
            <p className="text-sm text-default-500">No picks have been made yet.</p>
          ) : (
            draft.picks.map((pick) => (
              <div
                key={pick.id}
                className="rounded-medium border border-default-200/40 px-3 py-2 text-sm"
              >
                <p>
                  #{pick.overallPick} • Round {pick.roundNumber} • {pick.participantDisplayName}{" "}
                  drafted <span className="font-semibold">{pick.playerName}</span>
                  {pick.playerTeam ? ` (${pick.playerTeam})` : ""}
                  {pick.playerRole ? ` [${pick.playerRole}]` : ""}
                </p>
                <p className="text-xs text-default-500">
                  Picked by {pick.pickedByLabel ?? pick.pickedByUserId} at{" "}
                  {new Date(pick.pickedAt).toLocaleTimeString()}
                </p>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </section>
  );
};
