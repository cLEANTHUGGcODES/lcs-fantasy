"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  HeadToHeadMatchup,
  HeadToHeadSummary,
  HeadToHeadWeekStatus,
} from "@/lib/dashboard-standings";

const pointFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const formatPoints = (value: number): string => pointFormat.format(value);
const FLIP_CARD_DURATION_MS = 520;
const FLIP_CARD_STAGGER_MS = 78;

const formatDateKeyShort = (value: string | null): string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return "—";
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
};

const initialsForName = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

const statusColor = (
  status: HeadToHeadWeekStatus,
): "success" | "warning" | "primary" | "default" => {
  if (status === "active") {
    return "success";
  }
  if (status === "upcoming") {
    return "warning";
  }
  if (status === "finalized") {
    return "primary";
  }
  return "default";
};

const statusLabel = (status: HeadToHeadWeekStatus): string => {
  if (status === "active") {
    return "Live Week";
  }
  if (status === "upcoming") {
    return "Upcoming Week";
  }
  if (status === "finalized") {
    return "Finalized Week";
  }
  return "Offseason";
};

const MatchupAvatar = ({
  displayName,
  avatarBorderColor,
  avatarUrl,
}: {
  displayName: string;
  avatarBorderColor: string | null;
  avatarUrl: string | null;
}) => {
  const avatarBorderStyle = avatarBorderColor ? { outlineColor: avatarBorderColor } : undefined;

  if (avatarUrl) {
    return (
      <span
        className="relative inline-flex h-8 w-8 overflow-hidden rounded-full bg-default-200/30 outline outline-2 outline-default-300/40"
        style={avatarBorderStyle}
      >
        <Image
          src={avatarUrl}
          alt={`${displayName} avatar`}
          fill
          sizes="32px"
          quality={100}
          unoptimized
          className="object-cover object-center"
        />
      </span>
    );
  }

  return (
    <span
      className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-default-200/40 text-[11px] font-semibold text-default-600 outline outline-2 outline-default-300/40"
      style={avatarBorderStyle}
    >
      {initialsForName(displayName)}
    </span>
  );
};

const MatchupCard = ({
  matchup,
}: {
  matchup: HeadToHeadMatchup | null;
}) => {
  if (!matchup) {
    return (
      <div className="rounded-large border border-default-200/15 bg-content2/20 p-3">
        <p className="text-sm text-default-500">No matchup card</p>
      </div>
    );
  }

  const leftWinner = matchup.winnerUserId === matchup.left.userId;
  const rightWinner = matchup.right
    ? matchup.winnerUserId === matchup.right.userId
    : false;

  return (
    <div className="rounded-large border border-default-200/30 bg-content2/35 p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MatchupAvatar
              avatarBorderColor={matchup.left.avatarBorderColor}
              avatarUrl={matchup.left.avatarUrl}
              displayName={matchup.left.displayName}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">
                {matchup.left.teamName ?? matchup.left.displayName}
              </p>
              <p className="truncate text-[11px] leading-tight text-default-500">
                {matchup.left.displayName}
              </p>
            </div>
          </div>
        </div>

        <p
          className={`mono-points px-3 text-lg font-semibold sm:px-4 sm:text-xl ${
            leftWinner ? "text-success-400" : "text-default-300"
          }`}
        >
          {formatPoints(matchup.left.weekPoints)}
        </p>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
          vs
        </p>

        <p
          className={`mono-points px-3 text-lg font-semibold sm:px-4 sm:text-xl ${
            rightWinner ? "text-success-400" : "text-default-300"
          }`}
        >
          {matchup.right ? formatPoints(matchup.right.weekPoints) : "—"}
        </p>

        {matchup.right ? (
          <div className="min-w-0 text-right">
            <div className="flex items-center justify-end gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">
                  {matchup.right.teamName ?? matchup.right.displayName}
                </p>
                <p className="truncate text-[11px] leading-tight text-default-500">
                  {matchup.right.displayName}
                </p>
              </div>
              <MatchupAvatar
                avatarBorderColor={matchup.right.avatarBorderColor}
                avatarUrl={matchup.right.avatarUrl}
                displayName={matchup.right.displayName}
              />
            </div>
          </div>
        ) : (
          <div className="text-right">
            <p className="text-sm font-semibold text-default-300">BYE</p>
          </div>
        )}
      </div>
      {matchup.isTie && matchup.right ? (
        <p className="mt-2 text-[11px] text-[#C79B3B]">Current result: tie</p>
      ) : null}
    </div>
  );
};

export const WeeklyMatchupsPanel = ({
  headToHead,
}: {
  headToHead: HeadToHeadSummary;
}) => {
  const animationTimersRef = useRef<number[]>([]);
  const initialWeekIndex = useMemo(() => {
    if (headToHead.weeks.length === 0) {
      return 0;
    }
    if (headToHead.currentWeekNumber !== null) {
      const currentIndex = headToHead.weeks.findIndex(
        (entry) => entry.weekNumber === headToHead.currentWeekNumber,
      );
      if (currentIndex >= 0) {
        return currentIndex;
      }
    }
    return headToHead.weeks.length - 1;
  }, [headToHead.currentWeekNumber, headToHead.weeks]);

  const [selectedWeekIndex, setSelectedWeekIndex] = useState(initialWeekIndex);
  const [transitionTargetWeekIndex, setTransitionTargetWeekIndex] = useState<number | null>(null);
  const [isWeekTransitioning, setIsWeekTransitioning] = useState(false);

  useEffect(
    () => () => {
      for (const timer of animationTimersRef.current) {
        window.clearTimeout(timer);
      }
      animationTimersRef.current = [];
    },
    [],
  );

  const currentWeekIndex = useMemo(() => {
    if (headToHead.weeks.length === 0) {
      return 0;
    }
    return Math.min(Math.max(selectedWeekIndex, 0), headToHead.weeks.length - 1);
  }, [headToHead.weeks.length, selectedWeekIndex]);

  const selectedWeek =
    headToHead.weeks[currentWeekIndex] ?? headToHead.weeks[headToHead.weeks.length - 1] ?? null;
  const transitionWeek =
    transitionTargetWeekIndex === null
      ? null
      : headToHead.weeks[transitionTargetWeekIndex] ?? null;
  const weekForHeader = isWeekTransitioning && transitionWeek ? transitionWeek : selectedWeek;
  const canGoPrevious = currentWeekIndex > 0;
  const canGoNext = currentWeekIndex < headToHead.weeks.length - 1;
  const shouldShowFlipTransition = isWeekTransitioning && Boolean(transitionWeek);
  const transitionSlotCount = selectedWeek ? selectedWeek.matchups.length : 0;

  const runWeekFlipTransition = (targetWeekIndex: number) => {
    if (
      targetWeekIndex === currentWeekIndex ||
      targetWeekIndex < 0 ||
      targetWeekIndex > headToHead.weeks.length - 1 ||
      isWeekTransitioning
    ) {
      return;
    }

    const currentMatchupCount = headToHead.weeks[currentWeekIndex]?.matchups.length ?? 0;
    const targetMatchupCount = headToHead.weeks[targetWeekIndex]?.matchups.length ?? 0;
    const flipOutDurationMs =
      FLIP_CARD_DURATION_MS +
      Math.max(0, currentMatchupCount - 1) * FLIP_CARD_STAGGER_MS;
    const flipInDurationMs =
      FLIP_CARD_DURATION_MS +
      Math.max(0, targetMatchupCount - 1) * FLIP_CARD_STAGGER_MS;
    const totalTransitionDurationMs = Math.max(flipOutDurationMs, flipInDurationMs);

    for (const timer of animationTimersRef.current) {
      window.clearTimeout(timer);
    }
    animationTimersRef.current = [];

    setIsWeekTransitioning(true);
    setTransitionTargetWeekIndex(targetWeekIndex);

    const completeTimer = window.setTimeout(() => {
      setSelectedWeekIndex(targetWeekIndex);
      setTransitionTargetWeekIndex(null);
      setIsWeekTransitioning(false);
    }, totalTransitionDurationMs);

    animationTimersRef.current.push(completeTimer);
  };

  return (
    <Card className="overflow-x-hidden bg-content1/70">
      <CardHeader className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Across the league</h2>
          <p className="text-xs text-default-500">
            {weekForHeader
              ? `Week ${weekForHeader.weekNumber} • ${formatDateKeyShort(weekForHeader.startsOn)} - ${formatDateKeyShort(weekForHeader.endsOn)} • Refresh Wednesday, close Monday.`
              : "No matchup week available."}
          </p>
        </div>
        <Chip
          color={weekForHeader ? statusColor(weekForHeader.status) : "default"}
          variant="flat"
        >
          {weekForHeader ? statusLabel(weekForHeader.status) : "Offseason"}
        </Chip>
      </CardHeader>
      <CardBody className="space-y-2 overflow-x-hidden pb-0">
        {headToHead.weeks.length > 1 ? (
          <div className="flex w-full items-center justify-between">
            <Button
              isIconOnly
              aria-label="Previous week"
              className="h-8 w-8 rounded-medium border border-default-300/45 bg-content2/70 text-white shadow-sm backdrop-blur-sm data-[hover=true]:border-default-200/70 data-[hover=true]:bg-content2 data-[hover=true]:text-white data-[pressed=true]:bg-content2/85 data-[disabled=true]:border-default-300/25 data-[disabled=true]:bg-content2/35 data-[disabled=true]:text-default-400"
              size="sm"
              variant="light"
              isDisabled={!canGoPrevious || isWeekTransitioning}
              onPress={() => {
                if (!canGoPrevious) {
                  return;
                }
                runWeekFlipTransition(currentWeekIndex - 1);
              }}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              isIconOnly
              aria-label="Next week"
              className="h-8 w-8 rounded-medium border border-default-300/45 bg-content2/70 text-white shadow-sm backdrop-blur-sm data-[hover=true]:border-default-200/70 data-[hover=true]:bg-content2 data-[hover=true]:text-white data-[pressed=true]:bg-content2/85 data-[disabled=true]:border-default-300/25 data-[disabled=true]:bg-content2/35 data-[disabled=true]:text-default-400"
              size="sm"
              variant="light"
              isDisabled={!canGoNext || isWeekTransitioning}
              onPress={() => {
                if (!canGoNext) {
                  return;
                }
                runWeekFlipTransition(currentWeekIndex + 1);
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}

        {selectedWeek ? (
          <div className="overflow-hidden">
            {shouldShowFlipTransition && transitionWeek ? (
              <div className="space-y-2 overflow-hidden [perspective:1200px]">
                {Array.from({ length: transitionSlotCount }).map((_, index) => {
                  const outgoingMatchup = selectedWeek.matchups[index] ?? null;
                  const incomingMatchup = transitionWeek.matchups[index] ?? null;
                  const delaySeconds = index * (FLIP_CARD_STAGGER_MS / 1000);

                  return (
                    <div
                      key={`week-flip-${selectedWeek.weekNumber}-${transitionWeek.weekNumber}-${index}`}
                      className="[perspective:1200px]"
                    >
                      <div className="grid [transform-style:preserve-3d]">
                        <motion.div
                          animate={{
                            rotateX: 180,
                            transformOrigin: "center center",
                          }}
                          initial={{
                            rotateX: 0,
                            transformOrigin: "center center",
                          }}
                          transition={{
                            duration: FLIP_CARD_DURATION_MS / 1000,
                            delay: delaySeconds,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="[grid-area:1/1] [backface-visibility:hidden] [transform-style:preserve-3d]"
                        >
                          <MatchupCard matchup={outgoingMatchup} />
                        </motion.div>
                        {incomingMatchup ? (
                          <motion.div
                            animate={{
                              rotateX: 0,
                              transformOrigin: "center center",
                            }}
                            initial={{
                              rotateX: -180,
                              transformOrigin: "center center",
                            }}
                            transition={{
                              duration: FLIP_CARD_DURATION_MS / 1000,
                              delay: delaySeconds,
                              ease: [0.22, 1, 0.36, 1],
                            }}
                            className="[grid-area:1/1] [backface-visibility:hidden] [transform-style:preserve-3d]"
                          >
                            <MatchupCard matchup={incomingMatchup} />
                          </motion.div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : selectedWeek.matchups.length === 0 ? (
              <p className="rounded-large border border-default-200/30 bg-content2/35 px-3 py-3 text-sm text-default-500">
                No weekly matchups available yet.
              </p>
            ) : (
              <div className="space-y-2 overflow-hidden [perspective:1200px]">
                {selectedWeek.matchups.map((matchup) => (
                  <MatchupCard key={matchup.matchupKey} matchup={matchup} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="rounded-large border border-default-200/30 bg-content2/35 px-3 py-3 text-sm text-default-500">
            No weekly matchups available yet.
          </p>
        )}
      </CardBody>
    </Card>
  );
};
