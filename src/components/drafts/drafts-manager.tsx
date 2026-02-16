"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Link } from "@heroui/link";
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/popover";
import { Spinner } from "@heroui/spinner";
import { Tooltip } from "@heroui/tooltip";
import { Check, ChevronDown, ChevronUp, MoreHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import type { DraftDetail, DraftSummary, RegisteredUser } from "@/types/draft";

type DraftUsersResponse = {
  users: RegisteredUser[];
  error?: string;
};

type DraftListResponse = {
  drafts: DraftSummary[];
  error?: string;
};

type DraftDetailResponse = {
  draft?: DraftDetail;
  error?: string;
};

type SourceValidationResponse = {
  ok?: boolean;
  sourcePage?: string;
  storedAt?: string;
  gameCount?: number;
  playerCount?: number;
  error?: string;
};

type DraftSortMode = "newest" | "upcoming" | "live" | "completed";
type ParticipantSortMode = "name" | "recent" | "not-in-draft";

const createDefaultSchedule = (): string => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const localIso = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  return localIso;
};

const toLocalDateTimeValue = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return createDefaultSchedule();
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};

const formatDate = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const formatRelativeTime = (value: string, nowMs: number): string => {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "unknown";
  }
  const diffMinutes = Math.max(0, Math.round((nowMs - timestamp) / 60000));
  if (diffMinutes <= 0) {
    return "just now";
  }
  if (diffMinutes === 1) {
    return "1m ago";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (minutes === 0) {
    return `${hours}h ago`;
  }
  return `${hours}h ${minutes}m ago`;
};

const formatStartsIn = (value: string, nowMs: number): string => {
  const targetMs = new Date(value).getTime();
  if (Number.isNaN(targetMs)) {
    return "Set a valid draft time to preview countdown.";
  }
  const diffMs = targetMs - nowMs;
  const absoluteMinutes = Math.max(0, Math.round(Math.abs(diffMs) / 60000));
  const days = Math.floor(absoluteMinutes / (24 * 60));
  const hours = Math.floor((absoluteMinutes % (24 * 60)) / 60);
  const minutes = absoluteMinutes % 60;

  const parts: string[] = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(`${minutes}m`);
  }

  return diffMs >= 0
    ? `Starts in ${parts.join(" ")}`
    : `Started ${parts.join(" ")} ago`;
};

const seededRandom = (seed: number): (() => number) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
};

const shuffleUserIdsWithSeed = (userIds: string[], seed: number): string[] => {
  const random = seededRandom(seed);
  const shuffled = [...userIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }
  return shuffled;
};

const shuffleUserIds = (userIds: string[]): string[] => {
  const shuffled = [...userIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const temp = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }
  return shuffled;
};

const arraysEqual = (left: string[], right: string[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

const statusColor = (
  status: DraftSummary["status"],
): "default" | "success" | "warning" | "secondary" =>
  status === "live"
    ? "success"
    : status === "paused"
      ? "warning"
      : status === "completed"
        ? "secondary"
        : "default";

const parseNumber = (value: string): number | null => {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sourceResolutionSummary = (sourcePage: string): string | null => {
  const parts = sourcePage
    .split("/")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const league = parts[0]?.replaceAll("_", " ");
  const seasonToken = parts.find((entry) => /\d{4}/.test(entry));
  const seasonYear = seasonToken?.match(/(20\d{2})/)?.[1];
  const stage = parts[parts.length - 1]?.replaceAll("_", " ");
  if (!league || !stage) {
    return null;
  }
  return seasonYear
    ? `League: ${league} ${seasonYear} • ${stage}`
    : `League: ${league} • ${stage}`;
};

const scrollAreaClass =
  "max-h-[24rem] overflow-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-default-300/70";

export const DraftsManager = ({
  canManageAllDrafts,
  currentUserId,
  defaultSourcePage,
}: {
  canManageAllDrafts: boolean;
  currentUserId: string;
  defaultSourcePage: string;
}) => {
  const [users, setUsers] = useState<RegisteredUser[]>([]);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("Friends LCS Player Draft");
  const [leagueSlug, setLeagueSlug] = useState("LCS");
  const [seasonYear, setSeasonYear] = useState("2026");
  const [sourcePage, setSourcePage] = useState(defaultSourcePage);
  const [validatedSourcePage, setValidatedSourcePage] = useState<string | null>(null);
  const [sourceValidationStatus, setSourceValidationStatus] = useState<
    "idle" | "validating" | "valid" | "invalid"
  >("idle");
  const [sourceValidationMessage, setSourceValidationMessage] = useState<string | null>(null);
  const [sourceLastSyncedAt, setSourceLastSyncedAt] = useState<string | null>(null);
  const [sourceValidationCheckedAt, setSourceValidationCheckedAt] = useState<string | null>(null);

  const [scheduledAt, setScheduledAt] = useState(createDefaultSchedule);
  const [roundCount, setRoundCount] = useState("5");
  const [pickSeconds, setPickSeconds] = useState("75");

  const [participantUserIds, setParticipantUserIds] = useState<string[]>([]);
  const [participantSearch, setParticipantSearch] = useState("");
  const [selectedAvailableUserIds, setSelectedAvailableUserIds] = useState<string[]>([]);
  const [participantSortMode, setParticipantSortMode] = useState<ParticipantSortMode>("name");
  const [draggedUserId, setDraggedUserId] = useState<string | null>(null);
  const [randomizeUndoOrder, setRandomizeUndoOrder] = useState<string[] | null>(null);
  const [lastRandomizeSeed, setLastRandomizeSeed] = useState<number | null>(null);
  const [lastRandomizeAt, setLastRandomizeAt] = useState<string | null>(null);
  const [orderActionsOpen, setOrderActionsOpen] = useState(false);

  const [draftSortMode, setDraftSortMode] = useState<DraftSortMode>("newest");
  const [draftLeagueFilter, setDraftLeagueFilter] = useState("");
  const [draftSeasonFilter, setDraftSeasonFilter] = useState("");

  const [showTimingSection, setShowTimingSection] = useState(true);
  const [showDataSourceSection, setShowDataSourceSection] = useState(true);

  const [submitPending, setSubmitPending] = useState(false);
  const [deleteDraftIdPending, setDeleteDraftIdPending] = useState<number | null>(null);
  const [duplicateDraftIdPending, setDuplicateDraftIdPending] = useState<number | null>(null);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const [nowMs, setNowMs] = useState(() => Date.now());

  const timezoneLabel = useMemo(() => {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZoneName: "long",
    }).formatToParts(new Date());
    const zoneName = parts.find((entry) => entry.type === "timeZoneName")?.value ?? "Local time";
    const zoneId = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zoneId ? `${zoneName} (${zoneId})` : zoneName;
  }, []);

  const usersById = useMemo(
    () => new Map(users.map((entry) => [entry.userId, entry])),
    [users],
  );

  const selectedUsers = useMemo(
    () =>
      participantUserIds
        .map((userId) => usersById.get(userId))
        .filter((entry): entry is RegisteredUser => Boolean(entry)),
    [participantUserIds, usersById],
  );

  const participantPositionByUserId = useMemo(
    () => new Map(participantUserIds.map((userId, index) => [userId, index])),
    [participantUserIds],
  );

  const sortedParticipantUsers = useMemo(() => {
    const next = [...users];
    if (participantSortMode === "name") {
      return next.sort((left, right) => left.displayName.localeCompare(right.displayName));
    }
    if (participantSortMode === "recent") {
      return next.sort((left, right) => {
        const leftIndex = participantPositionByUserId.get(left.userId);
        const rightIndex = participantPositionByUserId.get(right.userId);
        const leftIsInDraft = typeof leftIndex === "number";
        const rightIsInDraft = typeof rightIndex === "number";
        if (leftIsInDraft !== rightIsInDraft) {
          return leftIsInDraft ? -1 : 1;
        }
        if (leftIsInDraft && rightIsInDraft && leftIndex !== rightIndex) {
          return (rightIndex ?? 0) - (leftIndex ?? 0);
        }
        return left.displayName.localeCompare(right.displayName);
      });
    }
    return next.sort((left, right) => {
      const leftIsInDraft = participantPositionByUserId.has(left.userId);
      const rightIsInDraft = participantPositionByUserId.has(right.userId);
      if (leftIsInDraft !== rightIsInDraft) {
        return leftIsInDraft ? 1 : -1;
      }
      return left.displayName.localeCompare(right.displayName);
    });
  }, [participantPositionByUserId, participantSortMode, users]);

  const filteredParticipantUsers = useMemo(() => {
    const query = participantSearch.trim().toLowerCase();
    if (!query) {
      return sortedParticipantUsers;
    }
    return sortedParticipantUsers.filter((entry) => {
      const haystack = `${entry.displayName} ${entry.teamName ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [participantSearch, sortedParticipantUsers]);

  const availableUsers = useMemo(
    () => users.filter((entry) => !participantPositionByUserId.has(entry.userId)),
    [participantPositionByUserId, users],
  );

  const selectableVisibleUserIds = useMemo(
    () =>
      filteredParticipantUsers
        .filter((entry) => !participantPositionByUserId.has(entry.userId))
        .map((entry) => entry.userId),
    [filteredParticipantUsers, participantPositionByUserId],
  );

  useEffect(() => {
    setSelectedAvailableUserIds((previous) =>
      previous.filter((userId) => selectableVisibleUserIds.includes(userId)),
    );
  }, [selectableVisibleUserIds]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const reloadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [usersResponse, draftsResponse] = await Promise.all([
        fetch("/api/drafts/users", { cache: "no-store" }),
        fetch("/api/drafts", { cache: "no-store" }),
      ]);

      const usersBody = (await usersResponse.json()) as DraftUsersResponse;
      const draftsBody = (await draftsResponse.json()) as DraftListResponse;

      if (!usersResponse.ok) {
        throw new Error(usersBody.error ?? "Failed to load registered users.");
      }
      if (!draftsResponse.ok) {
        throw new Error(draftsBody.error ?? "Failed to load drafts.");
      }

      setUsers(usersBody.users);
      setDrafts(draftsBody.drafts);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadData().catch((loadError: unknown) => {
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : "Unable to load draft data.");
    });
  }, [reloadData]);

  const roundCountNumber = parseNumber(roundCount);
  const pickSecondsNumber = parseNumber(pickSeconds);
  const seasonYearNumber = parseNumber(seasonYear);

  const roundCountIsValid = roundCountNumber !== null && roundCountNumber >= 1 && roundCountNumber <= 5;
  const pickSecondsIsValid =
    pickSecondsNumber !== null && pickSecondsNumber >= 1 && pickSecondsNumber <= 900;
  const seasonYearIsValid =
    seasonYearNumber !== null && seasonYearNumber >= 2020 && seasonYearNumber <= 2100;
  const scheduledAtIsValid = !Number.isNaN(new Date(scheduledAt).getTime());

  const sourcePageTrimmed = sourcePage.trim();
  const sourcePageIsValidated =
    sourceValidationStatus === "valid" && validatedSourcePage === sourcePageTrimmed;
  const sourceResolutionLabel = sourcePageIsValidated
    ? sourceResolutionSummary(sourcePageTrimmed)
    : null;
  const sourceLastCheckedLabel = sourceValidationCheckedAt
    ? formatRelativeTime(sourceValidationCheckedAt, nowMs)
    : null;

  const startsInLabel = useMemo(
    () => formatStartsIn(scheduledAt, nowMs),
    [scheduledAt, nowMs],
  );

  const roundOnePreview = useMemo(
    () => selectedUsers.map((entry) => entry.displayName).join(" -> "),
    [selectedUsers],
  );
  const roundTwoPreview = useMemo(
    () =>
      [...selectedUsers]
        .reverse()
        .map((entry) => entry.displayName)
        .join(" -> "),
    [selectedUsers],
  );
  const roundThreePreview = useMemo(
    () =>
      [...selectedUsers]
        .reverse()
        .map((entry) => entry.displayName)
        .join(" -> "),
    [selectedUsers],
  );

  const activeDraftCount = useMemo(
    () => drafts.filter((entry) => entry.status !== "completed").length,
    [drafts],
  );

  const filteredDrafts = useMemo(() => {
    const leagueFilterValue = draftLeagueFilter.trim().toLowerCase();
    const seasonFilterValue = draftSeasonFilter.trim();

    const next = drafts.filter((entry) => {
      const matchesLeague = leagueFilterValue
        ? entry.leagueSlug.toLowerCase().includes(leagueFilterValue)
        : true;
      const matchesSeason = seasonFilterValue
        ? String(entry.seasonYear).includes(seasonFilterValue)
        : true;
      return matchesLeague && matchesSeason;
    });

    const byNewest = (left: DraftSummary, right: DraftSummary): number =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();

    if (draftSortMode === "newest") {
      return next.sort(byNewest);
    }
    if (draftSortMode === "upcoming") {
      return next.sort(
        (left, right) =>
          new Date(left.scheduledAt).getTime() - new Date(right.scheduledAt).getTime(),
      );
    }
    if (draftSortMode === "live") {
      const rank: Record<DraftSummary["status"], number> = {
        live: 0,
        paused: 1,
        scheduled: 2,
        completed: 3,
      };
      return next.sort((left, right) => {
        const rankDiff = rank[left.status] - rank[right.status];
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return byNewest(left, right);
      });
    }
    const rank: Record<DraftSummary["status"], number> = {
      completed: 0,
      live: 1,
      paused: 2,
      scheduled: 3,
    };
    return next.sort((left, right) => {
      const rankDiff = rank[left.status] - rank[right.status];
      if (rankDiff !== 0) {
        return rankDiff;
      }
      return byNewest(left, right);
    });
  }, [draftLeagueFilter, draftSeasonFilter, draftSortMode, drafts]);

  const createDraftDisableReasons = useMemo(() => {
    const reasons: string[] = [];
    if (!name.trim()) {
      reasons.push("Draft name is required.");
    }
    if (!leagueSlug.trim()) {
      reasons.push("League slug is required.");
    }
    if (!seasonYearIsValid) {
      reasons.push("Season year must be between 2020 and 2100.");
    }
    if (!scheduledAtIsValid) {
      reasons.push("Draft time must be a valid date and time.");
    }
    if (!roundCountIsValid) {
      reasons.push("Rounds must be between 1 and 5.");
    }
    if (!pickSecondsIsValid) {
      reasons.push("Seconds per pick must be between 1 and 900.");
    }
    if (!sourcePageTrimmed) {
      reasons.push("League source page is required.");
    } else if (!sourcePageIsValidated) {
      reasons.push("Validate the league source page before creating the draft.");
    }
    if (participantUserIds.length < 2) {
      reasons.push("At least two participants are required.");
    }
    return reasons;
  }, [
    leagueSlug,
    name,
    participantUserIds.length,
    pickSecondsIsValid,
    roundCountIsValid,
    scheduledAtIsValid,
    seasonYearIsValid,
    sourcePageIsValidated,
    sourcePageTrimmed,
  ]);

  const createDraftSummary = useMemo(() => {
    if (!roundCountIsValid || !pickSecondsIsValid || !scheduledAtIsValid) {
      return "Complete required fields to preview draft summary.";
    }
    return `${roundCountNumber} rounds • ${pickSecondsNumber}s timer • ${participantUserIds.length} participants • starts ${formatDate(
      new Date(scheduledAt).toISOString(),
    )}`;
  }, [
    participantUserIds.length,
    pickSecondsIsValid,
    pickSecondsNumber,
    roundCountIsValid,
    roundCountNumber,
    scheduledAt,
    scheduledAtIsValid,
  ]);

  const readinessSummary = useMemo(
    () =>
      `${participantUserIds.length} participants • ${roundCountNumber ?? "-"} rounds • ${pickSecondsNumber ?? "-"}s • ${startsInLabel}`,
    [participantUserIds.length, pickSecondsNumber, roundCountNumber, startsInLabel],
  );

  const allVisibleSelectableUsersSelected =
    selectableVisibleUserIds.length > 0 &&
    selectableVisibleUserIds.every((userId) => selectedAvailableUserIds.includes(userId));

  const handleSourcePageChange = (value: string) => {
    setSourcePage(value);
    const normalized = value.trim();
    if (normalized !== validatedSourcePage) {
      setValidatedSourcePage(null);
      setSourceValidationStatus("idle");
      setSourceValidationMessage(null);
      setSourceLastSyncedAt(null);
      setSourceValidationCheckedAt(null);
    }
  };

  const resetDraftForm = () => {
    const confirmed = window.confirm("Discard current draft setup and reset the form?");
    if (!confirmed) {
      return;
    }

    setName("Friends LCS Player Draft");
    setLeagueSlug("LCS");
    setSeasonYear("2026");
    setSourcePage(defaultSourcePage);
    setValidatedSourcePage(null);
    setSourceValidationStatus("idle");
    setSourceValidationMessage(null);
    setSourceLastSyncedAt(null);
    setSourceValidationCheckedAt(null);
    setScheduledAt(createDefaultSchedule());
    setRoundCount("5");
    setPickSeconds("75");
    setParticipantUserIds([]);
    setParticipantSearch("");
    setParticipantSortMode("name");
    setSelectedAvailableUserIds([]);
    setShowTimingSection(true);
    setShowDataSourceSection(true);
    setRandomizeUndoOrder(null);
    setLastRandomizeSeed(null);
    setLastRandomizeAt(null);
    setSubmitMessage(null);
    setError(null);
  };

  const adjustRoundCount = (direction: -1 | 1) => {
    const base = roundCountNumber ?? 5;
    const next = Math.max(1, Math.min(5, base + direction));
    setRoundCount(String(next));
  };

  const adjustPickSeconds = (delta: number) => {
    const base = pickSecondsNumber ?? 75;
    const next = Math.max(1, Math.min(900, base + delta));
    setPickSeconds(String(next));
  };

  const addParticipant = (userId: string) => {
    if (participantUserIds.includes(userId)) {
      return;
    }
    setParticipantUserIds((previous) => [...previous, userId]);
  };

  const addSelectedParticipants = () => {
    if (selectedAvailableUserIds.length === 0) {
      return;
    }
    setParticipantUserIds((previous) => {
      const next = [...previous];
      for (const userId of selectedAvailableUserIds) {
        if (!next.includes(userId)) {
          next.push(userId);
        }
      }
      return next;
    });
    setSelectedAvailableUserIds([]);
  };

  const toggleSelectAllVisible = () => {
    if (selectableVisibleUserIds.length === 0) {
      return;
    }
    setSelectedAvailableUserIds((previous) => {
      if (allVisibleSelectableUsersSelected) {
        return previous.filter((userId) => !selectableVisibleUserIds.includes(userId));
      }
      const merged = new Set(previous);
      for (const userId of selectableVisibleUserIds) {
        merged.add(userId);
      }
      return Array.from(merged);
    });
  };

  const addAllParticipants = () => {
    if (availableUsers.length === 0) {
      return;
    }
    setParticipantUserIds((previous) => [
      ...previous,
      ...availableUsers.map((entry) => entry.userId),
    ]);
    setSelectedAvailableUserIds([]);
  };

  const clearParticipantOrder = () => {
    if (participantUserIds.length === 0) {
      return;
    }
    const confirmed = window.confirm("Clear the current draft order?");
    if (!confirmed) {
      return;
    }
    setRandomizeUndoOrder(participantUserIds);
    setParticipantUserIds([]);
  };

  const removeParticipant = (userId: string) => {
    setParticipantUserIds((previous) => previous.filter((entry) => entry !== userId));
  };

  const moveParticipant = (index: number, direction: -1 | 1) => {
    const next = [...participantUserIds];
    const target = index + direction;
    if (target < 0 || target >= next.length) {
      return;
    }
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    setParticipantUserIds(next);
  };

  const toggleAvailableUserSelection = (userId: string) => {
    setSelectedAvailableUserIds((previous) =>
      previous.includes(userId)
        ? previous.filter((entry) => entry !== userId)
        : [...previous, userId],
    );
  };

  const handleParticipantDragStart = (event: DragEvent<HTMLDivElement>, userId: string) => {
    event.dataTransfer.effectAllowed = "move";
    setDraggedUserId(userId);
  };

  const handleParticipantDrop = (targetUserId: string) => {
    if (!draggedUserId || draggedUserId === targetUserId) {
      setDraggedUserId(null);
      return;
    }
    setParticipantUserIds((previous) => {
      const sourceIndex = previous.indexOf(draggedUserId);
      const targetIndex = previous.indexOf(targetUserId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return previous;
      }
      const next = [...previous];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, draggedUserId);
      return next;
    });
    setDraggedUserId(null);
  };

  const randomizeParticipantOrder = () => {
    if (participantUserIds.length < 2) {
      return;
    }

    const previous = [...participantUserIds];
    const randomizedAt = new Date();
    let seed = Math.floor(randomizedAt.getTime() % 1_000_000_000);
    let shuffled = shuffleUserIdsWithSeed(previous, seed);
    let attempts = 0;
    while (attempts < 4 && arraysEqual(shuffled, previous)) {
      seed += 1;
      shuffled = shuffleUserIdsWithSeed(previous, seed);
      attempts += 1;
    }

    const preview = shuffled
      .map((userId, index) => `#${index + 1} ${usersById.get(userId)?.displayName ?? userId}`)
      .join("\n");
    const confirmed = window.confirm(
      `Preview randomized order\nSeed: ${seed}\nGenerated: ${randomizedAt.toLocaleTimeString()}\n\n${preview}\n\nApply this order?`,
    );
    if (!confirmed) {
      return;
    }

    setRandomizeUndoOrder(previous);
    setParticipantUserIds(shuffled);
    setLastRandomizeSeed(seed);
    setLastRandomizeAt(randomizedAt.toISOString());
    setSubmitMessage(`Draft order randomized (seed ${seed}). Undo is available.`);
  };

  const undoLastRandomize = () => {
    if (!randomizeUndoOrder) {
      return;
    }
    setParticipantUserIds(randomizeUndoOrder);
    setRandomizeUndoOrder(null);
    setLastRandomizeSeed(null);
    setLastRandomizeAt(null);
  };

  const generateOrderFromParticipants = () => {
    if (participantUserIds.length < 2) {
      return;
    }
    setRandomizeUndoOrder([...participantUserIds]);
    setParticipantUserIds(shuffleUserIds(participantUserIds));
    setSubmitMessage("Generated draft order from selected participants.");
  };

  const validateSourcePage = async () => {
    if (!sourcePageTrimmed) {
      setValidatedSourcePage(null);
      setSourceValidationStatus("invalid");
      setSourceValidationMessage("A source page is required.");
      setSourceLastSyncedAt(null);
      return;
    }

    setSourceValidationStatus("validating");
    setSourceValidationMessage(null);
    setSourceLastSyncedAt(null);
    setSourceValidationCheckedAt(null);
    setError(null);

    try {
      const response = await fetch("/api/drafts/validate-source", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          sourcePage: sourcePageTrimmed,
        }),
      });
      const payload = (await response.json()) as SourceValidationResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to validate source page.");
      }

      setValidatedSourcePage(sourcePageTrimmed);
      setSourceValidationStatus("valid");
      setSourceValidationMessage(
        `Source looks good: ${payload.gameCount ?? 0} games, ${payload.playerCount ?? 0} players.`,
      );
      setSourceLastSyncedAt(payload.storedAt ?? null);
      setSourceValidationCheckedAt(new Date().toISOString());
    } catch (validationError) {
      setValidatedSourcePage(null);
      setSourceValidationStatus("invalid");
      setSourceValidationMessage(
        validationError instanceof Error
          ? validationError.message
          : "Unable to validate source page.",
      );
      setSourceLastSyncedAt(null);
      setSourceValidationCheckedAt(new Date().toISOString());
    }
  };

  const createDraft = async () => {
    if (createDraftDisableReasons.length > 0) {
      setError(createDraftDisableReasons[0] ?? "Complete required fields before creating.");
      return;
    }
    if (!seasonYearNumber || !roundCountNumber || !pickSecondsNumber) {
      setError("Draft configuration is invalid.");
      return;
    }

    setSubmitPending(true);
    setSubmitMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/drafts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          leagueSlug: leagueSlug.trim(),
          seasonYear: seasonYearNumber,
          sourcePage: sourcePageTrimmed,
          scheduledAt: new Date(scheduledAt).toISOString(),
          roundCount: roundCountNumber,
          pickSeconds: pickSecondsNumber,
          participantUserIds,
        }),
      });

      const payload = (await response.json()) as { error?: string; draftId?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create draft.");
      }

      setSubmitMessage(`Draft #${payload.draftId} created successfully.`);
      setRandomizeUndoOrder(null);
      await reloadData();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create draft.");
    } finally {
      setSubmitPending(false);
    }
  };

  const duplicateDraftSettings = async (draft: DraftSummary) => {
    setDuplicateDraftIdPending(draft.id);
    setSubmitMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draft.id}`, { cache: "no-store" });
      const payload = (await response.json()) as DraftDetailResponse;

      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Unable to duplicate draft settings.");
      }

      const draftDetail = payload.draft;
      const orderedParticipants = [...draftDetail.participants].sort(
        (left, right) => left.draftPosition - right.draftPosition,
      );

      setName(`${draftDetail.name} Copy`);
      setLeagueSlug(draftDetail.leagueSlug);
      setSeasonYear(String(draftDetail.seasonYear));
      setSourcePage(draftDetail.sourcePage);
      setValidatedSourcePage(null);
      setSourceValidationStatus("idle");
      setSourceValidationMessage("Validate source page before creating this duplicate.");
      setSourceLastSyncedAt(null);
      setSourceValidationCheckedAt(null);
      setScheduledAt(toLocalDateTimeValue(draftDetail.scheduledAt));
      setRoundCount(String(draftDetail.roundCount));
      setPickSeconds(String(draftDetail.pickSeconds));
      setParticipantUserIds(orderedParticipants.map((entry) => entry.userId));
      setSelectedAvailableUserIds([]);
      setRandomizeUndoOrder(null);
      setSubmitMessage(`Copied settings from draft #${draft.id}.`);
    } catch (duplicateError) {
      setError(
        duplicateError instanceof Error
          ? duplicateError.message
          : "Unable to duplicate draft settings.",
      );
    } finally {
      setDuplicateDraftIdPending(null);
    }
  };

  const deleteDraft = async (draft: DraftSummary) => {
    const confirmed = window.confirm(
      `Delete draft "${draft.name}" (#${draft.id})? This permanently removes all picks and participants for this draft.`,
    );
    if (!confirmed) {
      return;
    }

    setDeleteDraftIdPending(draft.id);
    setSubmitMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/drafts/${draft.id}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
      });

      const payload = (await response.json()) as { error?: string; draftId?: number };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to delete draft.");
      }

      setSubmitMessage(`Draft #${payload.draftId ?? draft.id} deleted.`);
      await reloadData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Unable to delete draft.");
    } finally {
      setDeleteDraftIdPending(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Spinner label="Loading draft management..." />
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <Card className="border border-primary-300/30 bg-content1/70">
        <CardHeader className="pb-0">
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">Create Draft</h1>
              <p className="text-sm text-default-500">
                Configure a 3RR reverse-snake draft for a season.
              </p>
            </div>
            <Chip color="primary" variant="flat">
              Drafts: {activeDraftCount} active
            </Chip>
          </div>
        </CardHeader>
        <CardBody className="space-y-6 pt-5">
          {error ? <p className="text-sm text-danger-400">{error}</p> : null}
          {submitMessage ? <p className="text-sm text-success-400">{submitMessage}</p> : null}

          <div className="space-y-4 rounded-large border border-default-200/40 bg-content2/30 p-5">
            <h2 className="text-base font-semibold">Draft Basics</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Input
                isRequired
                label="Draft Name"
                labelPlacement="outside"
                value={name}
                onValueChange={setName}
              />
              <Input
                isRequired
                label="League Slug"
                labelPlacement="outside"
                value={leagueSlug}
                onValueChange={setLeagueSlug}
              />
              <Input
                isRequired
                errorMessage={seasonYear ? "Use a year between 2020 and 2100." : undefined}
                isInvalid={Boolean(seasonYear) && !seasonYearIsValid}
                label="Season Year"
                labelPlacement="outside"
                min={2020}
                max={2100}
                type="number"
                value={seasonYear}
                onValueChange={setSeasonYear}
              />
            </div>
          </div>

          <div className="space-y-3 rounded-large border border-default-200/40 bg-content2/30 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Timing</h2>
              <Button
                size="sm"
                variant="light"
                onPress={() => setShowTimingSection((previous) => !previous)}
              >
                {showTimingSection ? (
                  <>
                    Collapse <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Expand <ChevronDown className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
            {showTimingSection ? (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2 rounded-medium border border-default-200/40 p-3.5">
                    <Input
                      isRequired
                      label="Draft Time"
                      labelPlacement="outside"
                      type="datetime-local"
                      value={scheduledAt}
                      onValueChange={setScheduledAt}
                    />
                    <p className="text-xs text-default-500">Timezone: {timezoneLabel}</p>
                    <p className="text-xs text-default-500">{startsInLabel}</p>
                  </div>

                  <div className="space-y-2 rounded-medium border border-default-200/40 p-3.5">
                    <p className="text-sm font-medium">Rounds</p>
                    <div className="flex items-center gap-2">
                      <Button
                        isDisabled={(roundCountNumber ?? 1) <= 1}
                        size="sm"
                        variant="flat"
                        onPress={() => adjustRoundCount(-1)}
                      >
                        -
                      </Button>
                      <Input
                        className="max-w-[7rem]"
                        inputMode="numeric"
                        min={1}
                        max={5}
                        type="number"
                        value={roundCount}
                        onValueChange={setRoundCount}
                      />
                      <Button
                        isDisabled={(roundCountNumber ?? 5) >= 5}
                        size="sm"
                        variant="flat"
                        onPress={() => adjustRoundCount(1)}
                      >
                        +
                      </Button>
                      <p className="text-xs text-default-500">(max 5)</p>
                    </div>
                    <p className="text-xs text-default-500">Role slots: TOP / JNG / MID / ADC / SUP</p>
                  </div>
                </div>

                <div className="space-y-2 rounded-medium border border-default-200/40 p-3.5">
                  <p className="text-sm font-medium">Seconds Per Pick</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="flat" onPress={() => adjustPickSeconds(-5)}>
                      -5
                    </Button>
                    <Input
                      className="max-w-[8rem]"
                      inputMode="numeric"
                      min={1}
                      max={900}
                      type="number"
                      value={pickSeconds}
                      onValueChange={setPickSeconds}
                    />
                    <Button size="sm" variant="flat" onPress={() => adjustPickSeconds(5)}>
                      +5
                    </Button>
                    <div className="flex flex-wrap gap-1">
                      {[30, 60, 75, 90].map((preset) => (
                        <Button
                          key={preset}
                          size="sm"
                          variant={pickSecondsNumber === preset ? "solid" : "flat"}
                          onPress={() => setPickSeconds(String(preset))}
                        >
                          {preset}s
                        </Button>
                      ))}
                    </div>
                  </div>
                  <p className="text-xs text-default-500">Recommended: 60-90s per pick.</p>
                  {pickSecondsNumber === 1 ? (
                    <p className="text-xs text-warning-500">This is extremely fast.</p>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          <div className="space-y-3 rounded-large border border-default-200/40 bg-content2/30 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">Data Source</h2>
              <Button
                size="sm"
                variant="light"
                onPress={() => setShowDataSourceSection((previous) => !previous)}
              >
                {showDataSourceSection ? (
                  <>
                    Collapse <ChevronUp className="h-4 w-4" />
                  </>
                ) : (
                  <>
                    Expand <ChevronDown className="h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
            {showDataSourceSection ? (
              <>
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    isRequired
                    className="flex-1 min-w-[18rem]"
                    description="Use the same source page synced into Supabase snapshots."
                    label="League Source Page"
                    labelPlacement="outside"
                    value={sourcePage}
                    onValueChange={handleSourcePageChange}
                  />
                  <Button
                    color="primary"
                    isLoading={sourceValidationStatus === "validating"}
                    variant={sourceValidationStatus === "valid" ? "solid" : "flat"}
                    onPress={() => void validateSourcePage()}
                  >
                    Validate
                  </Button>
                </div>
                {sourceValidationStatus === "valid" ? (
                  <div className="space-y-1">
                    <p className="text-sm text-success-500">
                      ✓ Valid source{sourceLastCheckedLabel ? ` (last checked ${sourceLastCheckedLabel})` : ""}.
                    </p>
                    {sourceValidationMessage ? (
                      <p className="text-xs text-default-500">{sourceValidationMessage}</p>
                    ) : null}
                    {sourceResolutionLabel ? (
                      <p className="text-xs text-default-500">{sourceResolutionLabel}</p>
                    ) : null}
                  </div>
                ) : null}
                {sourceValidationStatus === "invalid" ? (
                  <p className="text-sm text-danger-500">
                    ✕ {sourceValidationMessage ?? "Not found / parse failed."}
                    {sourceLastCheckedLabel ? ` (last checked ${sourceLastCheckedLabel})` : ""}
                  </p>
                ) : null}
                {sourceLastSyncedAt ? (
                  <p className="text-xs text-default-500">Last synced: {formatDate(sourceLastSyncedAt)}</p>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="space-y-4 rounded-large border border-default-200/40 bg-content2/30 p-5">
            <h2 className="text-base font-semibold">Participants & Draft Order</h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card className="bg-content1/60">
                <CardHeader className="flex flex-col items-stretch gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                    <h3 className="text-base font-semibold">Registered Website Players</h3>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        isDisabled={selectedAvailableUserIds.length === 0}
                        color="primary"
                        size="sm"
                        variant="solid"
                        onPress={addSelectedParticipants}
                      >
                        Add Selected
                      </Button>
                      <Button
                        isDisabled={selectableVisibleUserIds.length === 0}
                        size="sm"
                        variant="flat"
                        onPress={toggleSelectAllVisible}
                      >
                        {allVisibleSelectableUsersSelected ? "Deselect Visible" : "Select All Visible"}
                      </Button>
                      <Button
                        isDisabled={availableUsers.length === 0}
                        size="sm"
                        variant="flat"
                        onPress={addAllParticipants}
                      >
                        Add All
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {(
                      [
                        { value: "name", label: "Name" },
                        { value: "recent", label: "Recently Added" },
                        { value: "not-in-draft", label: "Not in Draft" },
                      ] as const
                    ).map((entry) => (
                      <Button
                        key={entry.value}
                        color={participantSortMode === entry.value ? "primary" : "default"}
                        size="sm"
                        variant={participantSortMode === entry.value ? "solid" : "flat"}
                        onPress={() => setParticipantSortMode(entry.value)}
                      >
                        {entry.label}
                      </Button>
                    ))}
                  </div>
                  <Input
                    placeholder="Search players..."
                    value={participantSearch}
                    onValueChange={setParticipantSearch}
                  />
                </CardHeader>
                <CardBody className={`space-y-2 ${scrollAreaClass}`}>
                  {filteredParticipantUsers.length === 0 ? (
                    <p className="text-sm text-default-500">No users match this filter.</p>
                  ) : (
                    filteredParticipantUsers.map((entry) => {
                      const isInDraft = participantPositionByUserId.has(entry.userId);
                      const isSelectable = !isInDraft;

                      return (
                      <div
                        key={entry.userId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-medium border border-default-200/40 px-2 py-2"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                          <input
                            disabled={!isSelectable}
                            checked={selectedAvailableUserIds.includes(entry.userId)}
                            type="checkbox"
                            onChange={() => toggleAvailableUserSelection(entry.userId)}
                          />
                          <span className="min-w-0">
                            <p className="truncate text-sm font-medium">{entry.displayName}</p>
                            <p className="truncate text-xs text-default-500">
                              Team: {entry.teamName ?? "Not set"}
                            </p>
                          </span>
                        </label>
                        <Button
                          isDisabled={isInDraft}
                          size="sm"
                          variant="flat"
                          onPress={() => addParticipant(entry.userId)}
                        >
                          {isInDraft ? (
                            <span className="inline-flex items-center gap-1">
                              <Check className="h-3.5 w-3.5" /> Added
                            </span>
                          ) : (
                            "Add"
                          )}
                        </Button>
                      </div>
                      );
                    })
                  )}
                </CardBody>
              </Card>

              <Card className="bg-content1/60">
                <CardHeader className="flex flex-col items-stretch gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-semibold">Draft Order</h3>
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        color={participantUserIds.length < 2 && users.length >= 2 ? "primary" : "default"}
                        isDisabled={participantUserIds.length < 2}
                        size="sm"
                        variant={participantUserIds.length < 2 && users.length >= 2 ? "solid" : "flat"}
                        onPress={generateOrderFromParticipants}
                      >
                        Generate Order from Participants
                      </Button>
                      <Popover
                        isOpen={orderActionsOpen}
                        placement="bottom-end"
                        onOpenChange={setOrderActionsOpen}
                      >
                        <PopoverTrigger>
                          <Button size="sm" variant="flat">
                            <MoreHorizontal className="h-4 w-4" /> Order Actions
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent>
                          <div className="flex min-w-[12rem] flex-col gap-1 p-1">
                            <Button
                              isDisabled={selectedUsers.length < 2}
                              size="sm"
                              variant="flat"
                              onPress={() => {
                                setOrderActionsOpen(false);
                                randomizeParticipantOrder();
                              }}
                            >
                              Randomize
                            </Button>
                            <Button
                              isDisabled={!randomizeUndoOrder}
                              size="sm"
                              variant="flat"
                              onPress={() => {
                                setOrderActionsOpen(false);
                                undoLastRandomize();
                              }}
                            >
                              Undo
                            </Button>
                            <Button
                              color="danger"
                              isDisabled={selectedUsers.length === 0}
                              size="sm"
                              variant="flat"
                              onPress={() => {
                                setOrderActionsOpen(false);
                                clearParticipantOrder();
                              }}
                            >
                              Clear
                            </Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                  {lastRandomizeAt && lastRandomizeSeed !== null ? (
                    <p className="text-xs text-default-500">
                      Randomized at {formatDate(lastRandomizeAt)} (seed {lastRandomizeSeed}).
                    </p>
                  ) : null}
                  {selectedUsers.length >= 2 ? (
                    <div className="space-y-1 rounded-medium border border-default-200/40 px-3 py-2 text-xs text-default-500">
                      <p>3RR format: round 3 repeats round 2 direction.</p>
                      <p>Round 1 order: {roundOnePreview}</p>
                      <p>Round 2 order: {roundTwoPreview}</p>
                      <p>Round 3 order: {roundThreePreview}</p>
                    </div>
                  ) : null}
                </CardHeader>
                <CardBody className={`space-y-2 ${scrollAreaClass}`}>
                  {selectedUsers.length === 0 ? (
                    <div className="rounded-medium border border-dashed border-default-300/50 px-4 py-8 text-center">
                      <p className="text-sm text-default-500">
                        Add at least 2 participants, then generate order.
                      </p>
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                        <Button
                          isDisabled={availableUsers.length === 0}
                          size="sm"
                          variant="flat"
                          onPress={addAllParticipants}
                        >
                          Add All Participants
                        </Button>
                        <Tooltip content="Add at least 2 participants first.">
                          <span className="inline-flex">
                            <Button isDisabled size="sm" variant="flat">
                              Generate Order from Participants
                            </Button>
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                  ) : (
                    selectedUsers.map((entry, index) => (
                      <div
                        key={entry.userId}
                        draggable
                        className="flex flex-wrap items-center justify-between gap-2 rounded-medium border border-default-200/40 px-2 py-2"
                        onDragEnd={() => setDraggedUserId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDragStart={(event) => handleParticipantDragStart(event, entry.userId)}
                        onDrop={() => handleParticipantDrop(entry.userId)}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            #{index + 1} {entry.displayName}
                          </p>
                          <p className="truncate text-xs text-default-500">
                            ⋮⋮ Drag handle • Team: {entry.teamName ?? "Not set"}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Button
                            isDisabled={index === 0 || draggedUserId === entry.userId}
                            size="sm"
                            variant="flat"
                            onPress={() => moveParticipant(index, -1)}
                          >
                            ↑
                          </Button>
                          <Button
                            isDisabled={index === selectedUsers.length - 1 || draggedUserId === entry.userId}
                            size="sm"
                            variant="flat"
                            onPress={() => moveParticipant(index, 1)}
                          >
                            ↓
                          </Button>
                          <Button
                            color="danger"
                            size="sm"
                            variant="flat"
                            onPress={() => removeParticipant(entry.userId)}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </CardBody>
              </Card>
            </div>
          </div>

          <div className="sticky bottom-3 z-20 rounded-large border border-default-200/50 bg-content1/90 p-4 shadow-lg backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-xs text-default-500">{readinessSummary}</p>
                <p className="text-xs text-default-500">{createDraftSummary}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button isDisabled={submitPending} variant="flat" onPress={resetDraftForm}>
                  Cancel
                </Button>
                <Button
                  color="primary"
                  isDisabled={createDraftDisableReasons.length > 0}
                  isLoading={submitPending}
                  onPress={createDraft}
                >
                  {submitPending ? "Creating..." : "Create Draft"}
                </Button>
              </div>
            </div>
            {createDraftDisableReasons.length > 0 ? (
              <p className="mt-1 text-xs text-default-500">{createDraftDisableReasons[0]}</p>
            ) : null}
          </div>
        </CardBody>
      </Card>

      <Card className="border border-default-200/30 bg-content1/70">
        <CardHeader className="flex flex-col items-stretch gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-semibold">Existing Drafts</h2>
            <Button size="sm" variant="flat" onPress={() => void reloadData()}>
              Refresh
            </Button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Input
              className="min-w-[10rem] max-w-[14rem]"
              label="Filter League"
              labelPlacement="outside"
              size="sm"
              value={draftLeagueFilter}
              onValueChange={setDraftLeagueFilter}
            />
            <Input
              className="min-w-[8rem] max-w-[10rem]"
              label="Filter Season"
              labelPlacement="outside"
              size="sm"
              value={draftSeasonFilter}
              onValueChange={setDraftSeasonFilter}
            />
            {(
              [
                { value: "newest", label: "Newest" },
                { value: "upcoming", label: "Upcoming" },
                { value: "live", label: "Live" },
                { value: "completed", label: "Completed" },
              ] as const
            ).map((entry) => (
              <Button
                key={entry.value}
                color={draftSortMode === entry.value ? "primary" : "default"}
                size="sm"
                variant={draftSortMode === entry.value ? "solid" : "flat"}
                onPress={() => setDraftSortMode(entry.value)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardBody className="space-y-3">
          {filteredDrafts.length === 0 ? (
            <p className="text-sm text-default-500">No drafts match this filter.</p>
          ) : (
            filteredDrafts.map((draft) => (
              <div
                key={draft.id}
                className="space-y-3 rounded-large border border-default-200/40 px-3 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{draft.name}</p>
                    <p className="truncate text-xs text-default-500">
                      {draft.leagueSlug} {draft.seasonYear} • Starts {formatDate(draft.scheduledAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip color={statusColor(draft.status)} variant="flat">
                      {draft.status}
                    </Chip>
                    <Chip size="sm" variant="flat">
                      {draft.participantCount} participants
                    </Chip>
                    <Chip size="sm" variant="flat">
                      {draft.roundCount} rounds
                    </Chip>
                    <Chip size="sm" variant="flat">
                      3RR
                    </Chip>
                  </div>
                </div>
                <p className="truncate text-xs text-default-500">
                  Start {formatDate(draft.scheduledAt)} • Picks {draft.pickCount}/{draft.totalPickCount} •{" "}
                  {draft.pickSeconds}s timer
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button as={Link} color="primary" href={`/drafts/${draft.id}`} size="sm" variant="solid">
                    Open Draft Room
                  </Button>
                  <Button
                    isDisabled={
                      duplicateDraftIdPending !== null && duplicateDraftIdPending !== draft.id
                    }
                    isLoading={duplicateDraftIdPending === draft.id}
                    size="sm"
                    variant="flat"
                    onPress={() => void duplicateDraftSettings(draft)}
                  >
                    Duplicate Draft
                  </Button>
                  {draft.createdByUserId === currentUserId || canManageAllDrafts ? (
                    <Button
                      color="danger"
                      isDisabled={deleteDraftIdPending !== null && deleteDraftIdPending !== draft.id}
                      isLoading={deleteDraftIdPending === draft.id}
                      size="sm"
                      startContent={<Trash2 className="h-4 w-4" />}
                      variant="flat"
                      onPress={() => void deleteDraft(draft)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </section>
  );
};
