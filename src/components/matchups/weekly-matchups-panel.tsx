"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { HeadToHeadSummary, HeadToHeadWeekStatus } from "@/lib/dashboard-standings";

const pointFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const formatPoints = (value: number): string => pointFormat.format(value);

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
  avatarUrl,
}: {
  displayName: string;
  avatarUrl: string | null;
}) => {
  if (avatarUrl) {
    return (
      <span className="relative inline-flex h-8 w-8 overflow-hidden rounded-full border border-default-300/40 bg-default-200/30">
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
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-default-300/40 bg-default-200/40 text-[11px] font-semibold text-default-600">
      {initialsForName(displayName)}
    </span>
  );
};

export const WeeklyMatchupsPanel = ({
  headToHead,
}: {
  headToHead: HeadToHeadSummary;
}) => {
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

  useEffect(() => {
    setSelectedWeekIndex(initialWeekIndex);
  }, [initialWeekIndex]);

  const selectedWeek =
    headToHead.weeks[selectedWeekIndex] ?? headToHead.weeks[headToHead.weeks.length - 1] ?? null;
  const canGoPrevious = selectedWeekIndex > 0;
  const canGoNext = selectedWeekIndex < headToHead.weeks.length - 1;

  return (
    <Card className="overflow-x-hidden bg-content1/70">
      <CardHeader className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Weekly Matchups</h2>
          <p className="text-xs text-default-500">
            {selectedWeek
              ? `Week ${selectedWeek.weekNumber} • ${formatDateKeyShort(selectedWeek.startsOn)} - ${formatDateKeyShort(selectedWeek.endsOn)} • Refresh Wednesday, close Monday.`
              : "No matchup week available."}
          </p>
        </div>
        <Chip
          color={selectedWeek ? statusColor(selectedWeek.status) : "default"}
          variant="flat"
        >
          {selectedWeek ? statusLabel(selectedWeek.status) : "Offseason"}
        </Chip>
      </CardHeader>
      <CardBody className="space-y-2 overflow-x-hidden">
        {headToHead.weeks.length > 1 ? (
          <div className="flex w-full items-center justify-between">
            <Button
              isIconOnly
              aria-label="Previous week"
              className="h-8 w-8 rounded-medium border border-default-300/45 bg-content2/70 text-white shadow-sm backdrop-blur-sm data-[hover=true]:border-default-200/70 data-[hover=true]:bg-content2 data-[hover=true]:text-white data-[pressed=true]:bg-content2/85 data-[disabled=true]:border-default-300/25 data-[disabled=true]:bg-content2/35 data-[disabled=true]:text-default-400"
              size="sm"
              variant="light"
              isDisabled={!canGoPrevious}
              onPress={() => {
                if (!canGoPrevious) {
                  return;
                }
                setSelectedWeekIndex((value) => value - 1);
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
              isDisabled={!canGoNext}
              onPress={() => {
                if (!canGoNext) {
                  return;
                }
                setSelectedWeekIndex((value) => value + 1);
              }}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null}

        {selectedWeek ? (
          <motion.div key={selectedWeek.weekNumber} className="overflow-hidden">
            {selectedWeek.matchups.length === 0 ? (
              <p className="rounded-large border border-default-200/30 bg-content2/35 px-3 py-3 text-sm text-default-500">
                No weekly matchups available yet.
              </p>
            ) : (
              <div className="space-y-2 overflow-hidden [perspective:1200px]">
                {selectedWeek.matchups.map((matchup, index) => {
                  const leftWinner = matchup.winnerUserId === matchup.left.userId;
                  const rightWinner = matchup.right
                    ? matchup.winnerUserId === matchup.right.userId
                    : false;

                  return (
                    <motion.div
                      key={matchup.matchupKey}
                      initial={{
                        opacity: 0,
                        y: -4,
                        rotateX: -72,
                        transformOrigin: "top center",
                      }}
                      animate={{
                        opacity: 1,
                        y: 0,
                        rotateX: 0,
                        transformOrigin: "top center",
                      }}
                      transition={{
                        duration: 0.18,
                        delay: index * 0.02,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      className="will-change-transform [backface-visibility:hidden] [transform-style:preserve-3d]"
                    >
                      <div className="rounded-large border border-default-200/30 bg-content2/35 p-3">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-default-500">
                          <span>Week {matchup.weekNumber}</span>
                          <span>
                            {formatDateKeyShort(matchup.startsOn)} -{" "}
                            {formatDateKeyShort(matchup.endsOn)}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <MatchupAvatar
                                avatarUrl={matchup.left.avatarUrl}
                                displayName={matchup.left.displayName}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">
                                  {matchup.left.teamName ?? matchup.left.displayName}
                                </p>
                                <p className="truncate text-[11px] text-default-500">
                                  {matchup.left.displayName}
                                </p>
                              </div>
                            </div>
                            <p
                              className={`mono-points mt-1 text-sm font-semibold ${
                                leftWinner ? "text-success-400" : "text-default-300"
                              }`}
                            >
                              {formatPoints(matchup.left.weekPoints)}
                            </p>
                          </div>
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
                            vs
                          </p>
                          {matchup.right ? (
                            <div className="min-w-0 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold">
                                    {matchup.right.teamName ?? matchup.right.displayName}
                                  </p>
                                  <p className="truncate text-[11px] text-default-500">
                                    {matchup.right.displayName}
                                  </p>
                                </div>
                                <MatchupAvatar
                                  avatarUrl={matchup.right.avatarUrl}
                                  displayName={matchup.right.displayName}
                                />
                              </div>
                              <p
                                className={`mono-points mt-1 text-sm font-semibold ${
                                  rightWinner ? "text-success-400" : "text-default-300"
                                }`}
                              >
                                {formatPoints(matchup.right.weekPoints)}
                              </p>
                            </div>
                          ) : (
                            <div className="text-right">
                              <p className="text-sm font-semibold text-default-300">BYE</p>
                            </div>
                          )}
                        </div>
                        {matchup.isTie && matchup.right ? (
                          <p className="mt-2 text-[11px] text-warning-300">Current result: tie</p>
                        ) : null}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        ) : (
          <p className="rounded-large border border-default-200/30 bg-content2/35 px-3 py-3 text-sm text-default-500">
            No weekly matchups available yet.
          </p>
        )}
      </CardBody>
    </Card>
  );
};
