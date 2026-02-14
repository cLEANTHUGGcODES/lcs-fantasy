"use client";

import { Button } from "@heroui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
} from "@heroui/drawer";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/table";
import { Tooltip } from "@heroui/tooltip";
import { BookOpenText, CalendarDays, NotebookText, Sigma, Swords, Trophy } from "lucide-react";
import { useMemo, useState } from "react";
import type { FantasyScoring } from "@/types/fantasy";

const scoreWithSign = (value: number): string => {
  if (value > 0) {
    return `+${value}`;
  }
  return `${value}`;
};

const weightToneClass = (value: number): string => {
  if (value > 0) {
    return "text-success-200";
  }
  if (value < 0) {
    return "text-danger-200";
  }
  return "text-default-100";
};

export const ScoringMethodologyDrawer = ({
  scoring,
}: {
  scoring: FantasyScoring;
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const formula = useMemo(
    () =>
      `${scoring.kill}×K + ${scoring.death}×D + ${scoring.assist}×A + ${
        scoring.win
      }×Win + (${scoring.csPer100}×CS/100) + (${scoring.goldPer1000}×Gold/1000)`,
    [scoring],
  );

  const scoringRows = useMemo(
    () => [
      {
        metric: "Kill",
        value: scoring.kill,
        weight: scoreWithSign(scoring.kill),
        detail: "Applied per kill.",
      },
      {
        metric: "Death",
        value: scoring.death,
        weight: scoreWithSign(scoring.death),
        detail: "Applied per death.",
      },
      {
        metric: "Assist",
        value: scoring.assist,
        weight: scoreWithSign(scoring.assist),
        detail: "Applied per assist.",
      },
      {
        metric: "Win Bonus",
        value: scoring.win,
        weight: scoreWithSign(scoring.win),
        detail: "Added for map wins only.",
      },
      {
        metric: "CS Bonus",
        value: scoring.csPer100,
        weight: `${scoreWithSign(scoring.csPer100)} / 100 CS`,
        detail: "Scaled by creep score.",
      },
      {
        metric: "Gold Bonus",
        value: scoring.goldPer1000,
        weight: `${scoreWithSign(scoring.goldPer1000)} / 1000 Gold`,
        detail: "Scaled by gold earned.",
      },
    ],
    [scoring],
  );

  return (
    <>
      <Tooltip content="Scoring Methodology (FAQ)">
        <Button
          isIconOnly
          aria-label="Open scoring methodology FAQ"
          className="h-9 w-9 min-h-0 min-w-0 rounded-medium border border-default-300/40 bg-transparent p-0 text-[var(--insight-gold)] transition data-[hover=true]:border-default-200/70 data-[hover=true]:bg-transparent data-[hover=true]:text-[#d9ab45]"
          radius="sm"
          size="sm"
          variant="light"
          onPress={() => setIsOpen(true)}
        >
          <NotebookText className="h-4 w-4" />
        </Button>
      </Tooltip>

      <Drawer
        classNames={{
          wrapper: "z-[240]",
          base: "border-l border-[#314766] bg-[#0b1628] text-[#eaf0ff]",
          backdrop: "bg-[#020611]/70",
          header: "border-b border-[#314766]",
          body: "text-[#dbe6f8]",
          footer: "border-t border-[#314766]",
          closeButton:
            "text-[#b9cae7] hover:bg-[#142741] hover:text-[#C79B3B] data-[hover=true]:bg-[#142741] data-[hover=true]:text-[#C79B3B]",
        }}
        isOpen={isOpen}
        placement="right"
        scrollBehavior="inside"
        size="lg"
        onOpenChange={(open) => setIsOpen(open)}
      >
        <DrawerContent>
          {(onClose) => (
            <>
              <DrawerHeader className="pb-3">
                <div className="space-y-1">
                  <p className="text-[11px] uppercase tracking-wide text-[#9fb3d6]">
                    League Rules
                  </p>
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-[#f8fbff]">
                    <BookOpenText className="h-5 w-5 text-[#C79B3B]" />
                    Scoring Methodology
                  </h2>
                  <p className="text-xs text-[#c7d6ef]">
                    Exact scoring and standings logic currently used by INSIGHT LoL Fantasy.
                  </p>
                </div>
              </DrawerHeader>

              <DrawerBody className="space-y-5 py-4 text-sm text-[#dbe6f8]">
                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold text-[#f5f9ff]">
                    <Sigma className="h-4 w-4 text-primary-300" />
                    1) Player Scoring Weights
                  </h3>
                  <div className="overflow-hidden rounded-large border border-[#365173]/80 bg-[#12233d]/75 shadow-[0_10px_26px_rgba(3,8,18,0.45)]">
                    <Table
                      isStriped
                      removeWrapper
                      aria-label="Player scoring weights table"
                      classNames={{
                        base: "w-full",
                        table: "min-w-full table-fixed",
                        thead: "[&>tr]:bg-[#173050]/85",
                        th: "h-10 border-b border-[#3a5881]/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-[#bfd1ee]",
                        td: "h-12 border-b border-[#2a4567]/65 px-3 py-2 align-middle text-xs text-[#e3ecfb]",
                        tr: "last:[&>td]:border-b-0 odd:bg-[#10223a]/70 even:bg-[#142b47]/52 data-[hover=true]:bg-[#1d3960]/72",
                      }}
                    >
                      <TableHeader>
                        <TableColumn key="metric" className="w-[34%]">Metric</TableColumn>
                        <TableColumn key="weight" className="w-[30%]">Weight</TableColumn>
                        <TableColumn key="detail" className="w-[36%]">How It Applies</TableColumn>
                      </TableHeader>
                      <TableBody>
                        {scoringRows.map((row) => (
                          <TableRow key={row.metric}>
                            <TableCell className="font-medium text-[#f0f5ff]">{row.metric}</TableCell>
                            <TableCell>
                              <span
                                className={`mono-points text-[12px] font-semibold ${weightToneClass(
                                  row.value,
                                )}`}
                              >
                                {row.weight}
                              </span>
                            </TableCell>
                            <TableCell className="text-[#cddbf2]">{row.detail}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="text-xs text-[#adc2e2]">
                    Per-game points are rounded to two decimals.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold text-[#f5f9ff]">
                    <Swords className="h-4 w-4 text-success-300" />
                    2) Per-Game Fantasy Formula
                  </h3>
                  <div className="rounded-large border border-[#365173]/80 bg-[#12233d]/75 p-3">
                    <p className="mono-points break-words text-xs text-[#f8fbff]">{formula}</p>
                  </div>
                  <p className="text-xs text-[#adc2e2]">
                    `K, D, A` = kills/deaths/assists for that map. `Win` is 1 for a win and 0 for a loss.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold text-[#f5f9ff]">
                    <Trophy className="h-4 w-4 text-[#C79B3B]" />
                    3) Standings Logic
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-[#d2def4]">
                    <li>League Standings total each manager’s drafted player points.</li>
                    <li>Average/Pick is `Total Points ÷ Number of Drafted Players`.</li>
                    <li>H2H Record is based on weekly head-to-head matchups.</li>
                    <li>H2H table ranks by Win% first, then Points For (PF) as the tie-breaker.</li>
                    <li>Points Against (PA) tracks points scored by each week’s opponent.</li>
                  </ul>
                </section>

                <section className="space-y-2">
                  <h3 className="flex items-center gap-2 font-semibold text-[#f5f9ff]">
                    <CalendarDays className="h-4 w-4 text-secondary-300" />
                    4) Weekly Matchup Window
                  </h3>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-[#d2def4]">
                    <li>A scoring week runs Wednesday through Monday.</li>
                    <li>Tuesday is treated as the rollover/off-day between matchup weeks.</li>
                    <li>Only parsed games inside that week window count toward weekly H2H points.</li>
                    <li>Ties are allowed when weekly points are equal.</li>
                  </ul>
                </section>

                <section className="space-y-2">
                  <h3 className="font-semibold text-[#f5f9ff]">5) Draft + Roster Notes</h3>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-[#d2def4]">
                    <li>The completed draft defines each manager’s player pool for standings and H2H.</li>
                    <li>By default drafts are 5 rounds (4 starters + 1 bench), unless commissioner settings differ.</li>
                    <li>Current scoring rollups include all drafted players tied to that completed draft.</li>
                  </ul>
                </section>
              </DrawerBody>

              <DrawerFooter className="pt-3">
                <Button color="primary" variant="flat" onPress={onClose}>
                  Close
                </Button>
              </DrawerFooter>
            </>
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
};
