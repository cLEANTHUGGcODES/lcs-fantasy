"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Link } from "@heroui/link";
import { useEffect, useState } from "react";
import type { DraftStatus, DraftSummary } from "@/types/draft";

const statusColor = (status: DraftStatus): "default" | "success" | "warning" | "secondary" =>
  status === "live"
    ? "success"
    : status === "paused"
    ? "warning"
    : status === "completed"
    ? "secondary"
    : "default";

const pad2 = (value: number): string => `${Math.max(0, value)}`.padStart(2, "0");

const getCountdownParts = (
  scheduledAt: string,
  nowMs: number,
): {
  days: string;
  hours: string;
  minutes: string;
  seconds: string;
} => {
  const targetMs = new Date(scheduledAt).getTime();
  if (!Number.isFinite(targetMs)) {
    return {
      days: "00",
      hours: "00",
      minutes: "00",
      seconds: "00",
    };
  }

  const remainingMs = Math.max(0, targetMs - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return {
    days: pad2(days),
    hours: pad2(hours),
    minutes: pad2(minutes),
    seconds: pad2(seconds),
  };
};

const formatScheduledAt = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const draftStatusLabel = (status: DraftStatus): string =>
  status === "scheduled"
    ? "Draft scheduled"
    : status === "live"
    ? "Draft is live"
    : status === "paused"
    ? "Draft paused"
    : "Draft completed";

export const UserDraftRoomAccess = ({
  drafts,
}: {
  drafts: DraftSummary[];
}) => {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  if (drafts.length === 0) {
    return null;
  }

  return (
    <Card className="bg-content1/70">
      <CardHeader>
        <div>
          <h2 className="text-xl font-semibold">My Draft Rooms</h2>
          <p className="text-xs text-default-500">
            Quick access for drafts where you are a participant.
          </p>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {drafts.map((draft) => {
          const countdown = getCountdownParts(draft.scheduledAt, nowMs);

          return (
            <div
              key={draft.id}
              className="rounded-large border border-default-200/30 bg-default-100/5 p-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{draft.name}</p>
                  <p className="text-xs text-default-500">
                    {draft.leagueSlug} {draft.seasonYear} • Starts {formatScheduledAt(draft.scheduledAt)}
                  </p>
                </div>
                <Chip color={statusColor(draft.status)} size="sm" variant="flat">
                  {draft.status}
                </Chip>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-end gap-2">
                    <span className="inline-flex items-end gap-1 rounded-medium bg-black/20 px-2 py-1">
                      <span className="text-2xl font-bold leading-none text-white tabular-nums">
                        {countdown.days}
                      </span>
                      <span className="pb-[2px] text-[10px] font-semibold uppercase tracking-wide text-default-500">
                        D
                      </span>
                    </span>
                    <span className="inline-flex items-end gap-1 rounded-medium bg-black/20 px-2 py-1">
                      <span className="text-2xl font-bold leading-none text-white tabular-nums">
                        {countdown.hours}
                      </span>
                      <span className="pb-[2px] text-[10px] font-semibold uppercase tracking-wide text-default-500">
                        H
                      </span>
                    </span>
                    <span className="inline-flex items-end gap-1 rounded-medium bg-black/20 px-2 py-1">
                      <span className="text-2xl font-bold leading-none text-white tabular-nums">
                        {countdown.minutes}
                      </span>
                      <span className="pb-[2px] text-[10px] font-semibold uppercase tracking-wide text-default-500">
                        M
                      </span>
                    </span>
                    <span className="inline-flex items-end gap-1 rounded-medium bg-black/20 px-2 py-1">
                      <span className="text-2xl font-bold leading-none text-white tabular-nums">
                        {countdown.seconds}
                      </span>
                      <span className="pb-[2px] text-[10px] font-semibold uppercase tracking-wide text-default-500">
                        S
                      </span>
                    </span>
                  </div>
                  <p className="text-xs text-default-500">{draftStatusLabel(draft.status)}</p>
                </div>
                <Button
                  as={Link}
                  color={draft.status === "live" ? "success" : "primary"}
                  href={`/drafts/${draft.id}`}
                  size="sm"
                  variant="flat"
                >
                  Join Draft Room
                </Button>
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
};
