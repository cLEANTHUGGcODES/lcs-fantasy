"use client";

import { Tooltip } from "@heroui/tooltip";
import Image from "next/image";
import { useEffect, useState } from "react";
import { CroppedTeamLogo } from "@/components/cropped-team-logo";
import type { DashboardStandingBreakdown } from "@/lib/dashboard-standings";

const ROSTER_BREAKDOWN_COLORS = [
  "#0d1b2a",
  "#1b263b",
  "#415a77",
  "#778da9",
  "#e0e1dd",
] as const;

type SegmentWidthInfo = { widthPercent: number };

const pointFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const formatPoints = (value: number): string => pointFormat.format(value);
const LOL_FANDOM_ROLE_ICONS: Record<string, string> = {
  TOP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/4/44/Toprole_icon.png/revision/latest",
  JNG: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/f/fb/Junglerole_icon.png/revision/latest",
  MID: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/c/ce/Midrole_icon.png/revision/latest",
  ADC: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/d/d1/AD_Carryrole_icon.png/revision/latest",
  SUP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/7/73/Supportrole_icon.png/revision/latest",
};

const normalizeRole = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "top") {
    return "TOP";
  }
  if (normalized === "jungle" || normalized === "jg" || normalized === "jng") {
    return "JNG";
  }
  if (normalized === "mid" || normalized === "middle") {
    return "MID";
  }
  if (
    normalized === "adc" ||
    normalized === "adcarry" ||
    normalized === "ad carry" ||
    normalized === "bot" ||
    normalized === "bottom"
  ) {
    return "ADC";
  }
  if (normalized === "support" || normalized === "sup" || normalized === "supp") {
    return "SUP";
  }
  return null;
};

const roleIconUrl = (role: string | null): string | null => {
  const normalized = normalizeRole(role);
  return normalized ? LOL_FANDOM_ROLE_ICONS[normalized] ?? null : null;
};

const getSegmentWidthInfo = (
  breakdown: DashboardStandingBreakdown[],
  index: number,
): SegmentWidthInfo => {
  const segmentCount = Math.max(1, breakdown.length);
  const weightedPoints = breakdown.map((pick) => Math.max(0, pick.points));
  const totalWeightedPoints = weightedPoints.reduce((sum, value) => sum + value, 0);
  const minimumVisiblePercent = segmentCount > 1
    ? Math.min(2.25, 100 / segmentCount - 0.1)
    : 100;
  const reservedPercent = minimumVisiblePercent * segmentCount;
  const distributablePercent = Math.max(0, 100 - reservedPercent);

  const widthPercent = totalWeightedPoints > 0
    ? minimumVisiblePercent + (weightedPoints[index] / totalWeightedPoints) * distributablePercent
    : 100 / segmentCount;

  return { widthPercent };
};

export const RosterBreakdownStack = ({
  breakdown,
  ariaLabel,
}: {
  breakdown: DashboardStandingBreakdown[];
  ariaLabel: string;
}) => {
  const [tooltipsEnabled, setTooltipsEnabled] = useState(false);
  const sortedBreakdown = [...breakdown].sort((a, b) => {
    if (a.points !== b.points) {
      return b.points - a.points;
    }
    return a.playerName.localeCompare(b.playerName);
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTooltipsEnabled(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      aria-label={ariaLabel}
      className="flex h-3 w-full overflow-hidden rounded-full border-[0.5px] border-white/55 bg-[#0b1526]/65"
    >
      {sortedBreakdown.map((pick, index) => {
        const { widthPercent } = getSegmentWidthInfo(sortedBreakdown, index);
        const segmentLabel = `${pick.playerName}: ${formatPoints(pick.points)} points`;
        const roleUrl = roleIconUrl(pick.playerRole);
        const segmentNode = (
          <span
            aria-label={segmentLabel}
            className="block h-full transition-opacity hover:opacity-85"
            style={{
              backgroundColor: ROSTER_BREAKDOWN_COLORS[index % ROSTER_BREAKDOWN_COLORS.length],
              width: `${widthPercent}%`,
              flex: `0 0 ${widthPercent}%`,
              boxShadow:
                index < sortedBreakdown.length - 1
                  ? "inset -1px 0 0 rgba(10, 19, 34, 0.72)"
                  : "none",
            }}
          />
        );

        if (!tooltipsEnabled) {
          return (
            <span
              key={`${pick.playerName}-${index}`}
              aria-label={segmentLabel}
              className="block h-full transition-opacity hover:opacity-85"
              style={{
                backgroundColor: ROSTER_BREAKDOWN_COLORS[index % ROSTER_BREAKDOWN_COLORS.length],
                width: `${widthPercent}%`,
                flex: `0 0 ${widthPercent}%`,
                boxShadow:
                  index < breakdown.length - 1
                    ? "inset -1px 0 0 rgba(10, 19, 34, 0.72)"
                    : "none",
              }}
              title={`${pick.playerName} • ${formatPoints(pick.points)} pts`}
            />
          );
        }

        return (
          <Tooltip
            key={`${pick.playerName}-${index}`}
            classNames={{
              content:
                "rounded-medium border border-[#d6bb73]/40 bg-[#0c1628]/95 px-2.5 py-1.5 shadow-lg backdrop-blur-sm",
              arrow: "bg-[#0c1628]/95",
            }}
            closeDelay={60}
            content={(
              <div className="flex min-w-[150px] items-center">
                <div className="flex min-w-0 flex-1 items-center gap-1 justify-start">
                  {pick.playerTeamIconUrl ? (
                    <CroppedTeamLogo
                      alt={`${pick.playerTeam ?? "Team"} logo`}
                      frameClassName="h-4 w-[20px] rounded border border-[#5b6e8b]/60 bg-[#122036]"
                      height={14}
                      imageClassName="h-3.5"
                      src={pick.playerTeamIconUrl}
                      width={36}
                      onError={(event) => {
                        const wrapper = event.currentTarget.parentElement;
                        if (wrapper) {
                          wrapper.style.display = "none";
                        }
                      }}
                    />
                  ) : null}
                  {roleUrl ? (
                    <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-[#5b6e8b]/60 bg-[#122036]">
                      <Image
                        src={roleUrl}
                        alt={`${pick.playerRole ?? "Role"} icon`}
                        className="h-3 w-3 object-contain"
                        height={12}
                        width={12}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    </span>
                  ) : null}
                  <span className="truncate text-xs font-semibold text-[#f2d58c]">{pick.playerName}</span>
                </div>
                <span className="mono-points ml-auto shrink-0 pl-2 text-right text-xs text-white">
                  {formatPoints(pick.points)} pts
                </span>
              </div>
            )}
            delay={80}
            placement="top"
          >
            {segmentNode}
          </Tooltip>
        );
      })}
    </div>
  );
};
