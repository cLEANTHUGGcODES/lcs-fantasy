"use client";

import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Alert } from "@heroui/alert";
import { Drawer, DrawerBody, DrawerContent, DrawerHeader } from "@heroui/drawer";
import { Input } from "@heroui/input";
import { Link } from "@heroui/link";
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/popover";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Spinner } from "@heroui/spinner";
import {
  Table as HeroTable,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/table";
import { Tab, Tabs } from "@heroui/tabs";
import { Tooltip } from "@heroui/tooltip";
import {
  CircleCheckBig,
  ChevronDown,
  Cog,
  MoreHorizontal,
  ArrowDown,
  ArrowUp,
  Gauge,
  GripVertical,
  Pause,
  Play,
  Info,
  MessageCircle,
  Eye,
  Plus,
  Search,
  Shield,
  ShieldAlert,
  SkipForward,
  SquareCheckBig,
  TableProperties,
  UserCheck,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Image from "next/image";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GlobalChatPanel } from "@/components/chat/global-chat-panel";
import { CroppedTeamLogo } from "@/components/cropped-team-logo";
import { getPickSlot, isThreeRoundReversalRound } from "@/lib/draft-engine";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { DraftDetail, DraftStatus } from "@/types/draft";

type DraftDetailResponse = {
  draft?: DraftDetail;
  error?: string;
  code?: string;
};

type DraftPresenceResponse = DraftDetailResponse & {
  ok?: boolean;
  serverNow?: string;
};

type DraftClientMetricName =
  | "client_draft_refresh_latency_ms"
  | "client_draft_presence_latency_ms"
  | "client_draft_pick_latency_ms"
  | "client_draft_status_latency_ms"
  | "client_realtime_disconnect"
  | "client_refresh_retry";

type DraftClientMetricEvent = {
  metricName: DraftClientMetricName;
  metricValue: number;
  metadata?: Record<string, unknown>;
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

const formatEtaFromMs = (ms: number | null): string => {
  if (ms === null) {
    return "N/A";
  }
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
};

const formatShortPlayerName = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "Pending";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return trimmed;
  }
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1]?.[0]?.toUpperCase();
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
};

const initialsForLabel = (value: string | null | undefined): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "??";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  const first = parts[0]?.[0] ?? "";
  const last = parts[parts.length - 1]?.[0] ?? "";
  return `${first}${last}`.toUpperCase();
};

type ChampionTendencyEntry = NonNullable<
  DraftDetail["playerPool"][number]["analytics"]
>["topChampions"][number];

const championInitials = (champion: string): string => {
  const trimmed = champion.trim();
  if (!trimmed) {
    return "?";
  }
  return initialsForLabel(trimmed).slice(0, 2);
};

const formatChampionTendencyStats = (entry: ChampionTendencyEntry): string =>
  `${entry.games}g • ${entry.winRate.toFixed(1)}% WR • ${entry.averageFantasyPoints.toFixed(2)} avg`;

const DDRAGON_ICON_VERSION = "15.1.1";
const DDRAGON_ICON_BASE_URL = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_ICON_VERSION}/img/champion`;

const CHAMPION_TO_DDRAGON_ID: Record<string, string> = {
  aurelionsol: "AurelionSol",
  belveth: "Belveth",
  chogath: "Chogath",
  drmundo: "DrMundo",
  jarvaniv: "JarvanIV",
  kaisa: "Kaisa",
  khazix: "Khazix",
  kogmaw: "KogMaw",
  ksante: "KSante",
  leblanc: "Leblanc",
  masteryi: "MasterYi",
  missfortune: "MissFortune",
  monkeyking: "MonkeyKing",
  nunuandwillump: "Nunu",
  nunuwillump: "Nunu",
  reksai: "RekSai",
  renataglasc: "Renata",
  tahmkench: "TahmKench",
  twistedfate: "TwistedFate",
  velkoz: "Velkoz",
  wukong: "MonkeyKing",
  xinzhao: "XinZhao",
};

const normalizeChampionKey = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const championDataDragonIconUrl = (championName: string): string | null => {
  const normalizedKey = normalizeChampionKey(championName);
  if (!normalizedKey) {
    return null;
  }
  const championId =
    CHAMPION_TO_DDRAGON_ID[normalizedKey] ??
    championName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[’'`]/g, " ")
      .split(/[^A-Za-z0-9]+/)
      .filter((part) => part.length > 0)
      .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
      .join("");
  if (!championId) {
    return null;
  }
  return `${DDRAGON_ICON_BASE_URL}/${championId}.png`;
};

const isDataDragonChampionIconUrl = (value: string): boolean =>
  value.includes("ddragon.leagueoflegends.com/");

const DEFAULT_CHAMPION_SPRITE_BASE_SIZE = 60;

const parseBackgroundPxValues = (value: string): number[] => {
  const matches = value.match(/-?\d+(?:\.\d+)?(?=px)/g);
  if (!matches) {
    return [];
  }

  return matches
    .map((entry) => Number.parseFloat(entry))
    .filter((entry) => Number.isFinite(entry));
};

const isMultipleOf = (value: number, divisor: number): boolean => {
  if (!Number.isFinite(value) || !Number.isFinite(divisor) || divisor === 0) {
    return false;
  }
  const quotient = value / divisor;
  return Math.abs(quotient - Math.round(quotient)) < 0.01;
};

const inferChampionSpriteBaseSize = (
  positionParts: number[],
  sizeParts: number[],
): number => {
  const absolutePositionParts = positionParts
    .map((value) => Math.abs(value))
    .filter((value) => value > 0);

  if (absolutePositionParts.length > 0) {
    for (const candidate of [62, 60, 31, 30]) {
      if (absolutePositionParts.every((value) => isMultipleOf(value, candidate))) {
        return candidate;
      }
    }
  }

  const sizeWidth = Math.abs(sizeParts[0] ?? 0);
  if (sizeWidth >= 900) {
    return 62;
  }
  if (sizeWidth >= 450) {
    return 31;
  }

  return DEFAULT_CHAMPION_SPRITE_BASE_SIZE;
};

const scaleCssPxValue = (value: string, scale: number): string =>
  value.replace(/-?\d+(?:\.\d+)?px/g, (match) => {
    const numeric = Number.parseFloat(match.slice(0, -2));
    if (!Number.isFinite(numeric)) {
      return match;
    }
    const scaled = (numeric * scale).toFixed(3).replace(/\.?0+$/, "");
    return `${scaled}px`;
  });

const championSpriteStyle = (
  entry: ChampionTendencyEntry,
  targetSizePx: number,
): CSSProperties | null => {
  if (
    !entry.championSpriteUrl ||
    !entry.championSpriteBackgroundPosition ||
    !entry.championSpriteBackgroundSize
  ) {
    return null;
  }

  const positionParts = parseBackgroundPxValues(
    entry.championSpriteBackgroundPosition,
  );
  const sizeParts = parseBackgroundPxValues(entry.championSpriteBackgroundSize);
  const sourceBaseSize = inferChampionSpriteBaseSize(positionParts, sizeParts);
  const scale = targetSizePx / sourceBaseSize;

  const scaledBackgroundPosition = scaleCssPxValue(
    entry.championSpriteBackgroundPosition,
    scale,
  );
  const scaledBackgroundSize = scaleCssPxValue(
    entry.championSpriteBackgroundSize,
    scale,
  );

  return {
    backgroundImage: `url(${entry.championSpriteUrl})`,
    backgroundPosition: scaledBackgroundPosition,
    backgroundRepeat: "no-repeat",
    backgroundSize: scaledBackgroundSize,
  };
};

const parseServerTimingTotalMs = (headerValue: string | null): number | null => {
  if (!headerValue) {
    return null;
  }

  const parts = headerValue.split(",");
  for (const rawPart of parts) {
    const part = rawPart.trim();
    if (!part.toLowerCase().startsWith("total")) {
      continue;
    }
    const match = /(?:^|;)\s*dur=([0-9]+(?:\.[0-9]+)?)/i.exec(part);
    if (!match) {
      continue;
    }
    const parsed = Number.parseFloat(match[1]);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return null;
};

const boardPickForSlot = ({
  picksByRoundAndParticipantUserId,
  roundNumber,
  participantUserId,
}: {
  picksByRoundAndParticipantUserId: Map<string, DraftDetail["picks"][number]>;
  roundNumber: number;
  participantUserId: string;
}) => {
  return picksByRoundAndParticipantUserId.get(`${roundNumber}::${participantUserId}`) ?? null;
};

const PRIMARY_ROLE_FILTERS = ["TOP", "JNG", "MID", "ADC", "SUP"] as const;
const UNASSIGNED_ROLE = "UNASSIGNED";
const DRAFT_ROOM_UNASSIGNED_ALIASES = new Set(["FLEX", "UTILITY", "N/A", "NA", "NONE"]);
const DRAFT_ROOM_ROLE_ALIASES: Record<string, string> = {
  TOPLANE: "TOP",
  JGL: "JNG",
  JUNGLE: "JNG",
  MIDLANE: "MID",
  MIDDLE: "MID",
  MIDLANER: "MID",
  BOT: "ADC",
  BOTTOM: "ADC",
  BOTLANE: "ADC",
  AD: "ADC",
  ADCARRY: "ADC",
  SUPPORT: "SUP",
  SUPP: "SUP",
};
const LOL_FANDOM_ROLE_ICONS: Record<string, string> = {
  TOP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/4/44/Toprole_icon.png/revision/latest",
  JNG: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/f/fb/Junglerole_icon.png/revision/latest",
  MID: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/c/ce/Midrole_icon.png/revision/latest",
  ADC: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/d/d1/AD_Carryrole_icon.png/revision/latest",
  SUP: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/7/73/Supportrole_icon.png/revision/latest",
};

const normalizeRole = (role: string | null): string => {
  const value = role?.trim().toUpperCase();
  if (!value || DRAFT_ROOM_UNASSIGNED_ALIASES.has(value)) {
    return UNASSIGNED_ROLE;
  }
  const compactValue = value.replace(/[\s/_-]+/g, "");
  if (DRAFT_ROOM_UNASSIGNED_ALIASES.has(compactValue)) {
    return UNASSIGNED_ROLE;
  }
  return DRAFT_ROOM_ROLE_ALIASES[compactValue] ?? value;
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
    return "border border-yellow-300/70 bg-yellow-100 text-yellow-900 dark:border-yellow-300/45 dark:bg-yellow-500/25 dark:text-yellow-100";
  }
  if (normalized === "ADC") {
    return "border border-violet-300/70 bg-violet-100 text-violet-800 dark:border-violet-300/40 dark:bg-violet-500/20 dark:text-violet-200";
  }
  if (normalized === "SUP") {
    return "border border-pink-300/80 bg-pink-100 text-pink-800 dark:border-pink-300/45 dark:bg-pink-500/25 dark:text-pink-100";
  }
  return "border border-default-300/70 bg-default-100 text-default-700 dark:border-default-300/40 dark:bg-default-500/20 dark:text-default-200";
};

const roleTileClassName = (role: string | null): string => {
  const normalized = normalizeRole(role);
  if (normalized === "TOP") {
    return "border-rose-300/60 bg-rose-500/16";
  }
  if (normalized === "JNG") {
    return "border-emerald-300/60 bg-emerald-500/16";
  }
  if (normalized === "MID") {
    return "border-yellow-300/70 bg-yellow-500/20";
  }
  if (normalized === "ADC") {
    return "border-violet-300/60 bg-violet-500/16";
  }
  if (normalized === "SUP") {
    return "border-pink-300/60 bg-pink-500/16";
  }
  return "border-default-200/35 bg-content2/25";
};

const DRAFT_SETTINGS_STORAGE_KEY = "draft-room-settings-v1";
const DRAFT_ROOM_DESKTOP_CHAT_COLLAPSE_KEY = "draft-room-desktop-chat-collapsed-v1";
const MAIN_TOP_BG_IMAGE_SRC = "/img/main_top.jpg?v=20260218-1";
const QUEUE_BG_IMAGE_SRC = "/img/queue_bg_1.jpg?v=20260218-1";
const TOP_SECTION_BORDER_GRADIENT =
  "conic-gradient(from 0deg, rgba(56, 189, 248, 0.85), rgba(147, 197, 253, 0.95), rgba(199, 155, 59, 0.9), rgba(248, 113, 113, 0.85), rgba(56, 189, 248, 0.85))";
const AUTOPICK_TRIGGER_MS = 6000;
const TIMEOUT_AUTOPICK_LABEL = "Auto Pick (Timeout)";
const TOAST_DURATION_MS = 2800;
const DOUBLE_TAP_WINDOW_MS = 320;
const REALTIME_REFRESH_DEBOUNCE_MS = 320;
const PRESENCE_REFRESH_DEBOUNCE_MS = 1200;
const REALTIME_READ_ONLY_STALE_MULTIPLIER = 4;
const REALTIME_READ_ONLY_MIN_STALE_SECONDS = 10;
const REALTIME_RESUBSCRIBE_DELAY_MS = 5000;
const REALTIME_SYNC_TOAST_COOLDOWN_MS = 6000;
const DRAFT_CLIENT_METRICS_FLUSH_INTERVAL_MS = 30000;
const DRAFT_CLIENT_METRICS_MAX_BATCH = 24;
const DRAFT_CLIENT_METRICS_MAX_QUEUE = 120;
const DRAFT_CLIENT_METRICS_MAX_VALUE = 600000;
const ROLE_SCARCITY_THRESHOLD = 2;
const QUEUE_EMPTY_AUTOPICK_WARNING =
  "Queue empty - autopick will use Best Available with server constraints.";
const QUEUE_UNAVAILABLE_AUTOPICK_WARNING =
  "Queued players are unavailable - autopick will use Best Available with server constraints.";
const QUEUE_INELIGIBLE_AUTOPICK_WARNING =
  "Queued players do not match your open roles - autopick will use Best Available with server constraints.";
const TOP_PICK_STRIP_OFFSETS = [-4, -3, -2, -1, 0, 1, 2, 3, 4] as const;
const TOP_PICK_STRIP_LAYOUT_DURATION = 0.34;
const TOP_PICK_STRIP_FADE_DURATION = 0.24;
const TOP_PICK_STRIP_HIGHLIGHT_MS = 900;

const isTimeoutAutopickPick = (pick: DraftDetail["picks"][number] | null): boolean =>
  Boolean(pick && pick.pickedByLabel === TIMEOUT_AUTOPICK_LABEL);

type PlayerSortKey = "name" | "team" | "role" | "rank" | "pos";

type DraftRoomSettings = {
  muted: boolean;
  vibrateOnTurn: boolean;
  requirePickConfirm: boolean;
  autoPickFromQueue: boolean;
};

const DEFAULT_DRAFT_ROOM_SETTINGS: DraftRoomSettings = {
  muted: false,
  vibrateOnTurn: true,
  requirePickConfirm: true,
  autoPickFromQueue: true,
};

type ToastNotice = {
  id: number;
  message: string;
};

type DraftSystemFeedEvent = {
  id: number;
  label: string;
  overallPick?: number;
  createdAtMs: number;
};

type StateBannerColor =
  | "default"
  | "primary"
  | "secondary"
  | "success"
  | "warning"
  | "danger";

type StateBanner = {
  label: string;
  detail: string;
  color: StateBannerColor;
  icon: LucideIcon;
  iconClassName: string;
  iconOnly?: boolean;
};

const toastColorForMessage = (message: string): "primary" | "success" | "warning" | "danger" => {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("unable") ||
    normalized.includes("blocked")
  ) {
    return "danger";
  }
  if (
    normalized.includes("warning") ||
    normalized.includes("timeout") ||
    normalized.includes("reconnect")
  ) {
    return "warning";
  }
  if (
    normalized.includes("synced") ||
    normalized.includes("saved") ||
    normalized.includes("added") ||
    normalized.includes("queued")
  ) {
    return "success";
  }
  return "primary";
};

const normalizeForSort = (value: string | null | undefined): string =>
  value?.trim().toUpperCase() ?? "";

const normalizePlayerLookupKey = (value: string | null | undefined): string =>
  value
    ?.replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase() ?? "";

const stripTrailingTeamSuffix = (value: string): string =>
  value.replace(/\s+\([^)]*\)\s*$/, "").trim();

type ClockRingPalette = {
  active: string;
  faded: string;
  border: string;
};

const CLOCK_RING_WARNING_THRESHOLD_PERCENT = 45;
const CLOCK_RING_DANGER_THRESHOLD_PERCENT = 20;
const CLOCK_RING_NEUTRAL_PALETTE: ClockRingPalette = {
  active: "rgba(199,155,59,0.95)",
  faded: "rgba(199,155,59,0.18)",
  border: "rgba(199,155,59,0.45)",
};
const CLOCK_RING_SAFE_PALETTE: ClockRingPalette = {
  active: "rgba(74,222,128,0.95)",
  faded: "rgba(74,222,128,0.2)",
  border: "rgba(74,222,128,0.55)",
};
const CLOCK_RING_WARNING_PALETTE: ClockRingPalette = {
  active: "rgba(250,204,21,0.95)",
  faded: "rgba(250,204,21,0.2)",
  border: "rgba(250,204,21,0.55)",
};
const CLOCK_RING_DANGER_PALETTE: ClockRingPalette = {
  active: "rgba(248,113,113,0.95)",
  faded: "rgba(248,113,113,0.2)",
  border: "rgba(248,113,113,0.55)",
};

const clockRingPaletteForProgress = (progressPercent: number): ClockRingPalette => {
  if (progressPercent <= CLOCK_RING_DANGER_THRESHOLD_PERCENT) {
    return CLOCK_RING_DANGER_PALETTE;
  }
  if (progressPercent <= CLOCK_RING_WARNING_THRESHOLD_PERCENT) {
    return CLOCK_RING_WARNING_PALETTE;
  }
  return CLOCK_RING_SAFE_PALETTE;
};

const buildClockRingGradient = (
  progressPercent: number,
  palette: ClockRingPalette = clockRingPaletteForProgress(progressPercent),
): string => `conic-gradient(${palette.active} ${progressPercent}%, ${palette.faded} 0)`;

const sourceLinkForPage = (page: string): string =>
  `https://lol.fandom.com/wiki/${page.replace(/\s+/g, "_")}`;

const sortAvailablePlayers = (
  players: DraftDetail["availablePlayers"],
  sortKey: PlayerSortKey,
) => {
  const next = [...players];
  next.sort((left, right) => {
    if (sortKey === "pos") {
      const leftRole = normalizeForSort(left.playerRole);
      const rightRole = normalizeForSort(right.playerRole);
      const leftRank = left.analytics?.positionRank ?? Number.POSITIVE_INFINITY;
      const rightRank = right.analytics?.positionRank ?? Number.POSITIVE_INFINITY;
      return (
        leftRole.localeCompare(rightRole) ||
        leftRank - rightRank ||
        normalizeForSort(left.playerName).localeCompare(normalizeForSort(right.playerName))
      );
    }
    if (sortKey === "rank") {
      const leftRank = left.analytics?.overallRank ?? Number.POSITIVE_INFINITY;
      const rightRank = right.analytics?.overallRank ?? Number.POSITIVE_INFINITY;
      return (
        leftRank - rightRank ||
        normalizeForSort(left.playerName).localeCompare(normalizeForSort(right.playerName))
      );
    }
    if (sortKey === "team") {
      return (
        normalizeForSort(left.playerTeam).localeCompare(normalizeForSort(right.playerTeam)) ||
        normalizeForSort(left.playerName).localeCompare(normalizeForSort(right.playerName))
      );
    }
    if (sortKey === "role") {
      return (
        normalizeForSort(left.playerRole).localeCompare(normalizeForSort(right.playerRole)) ||
        normalizeForSort(left.playerName).localeCompare(normalizeForSort(right.playerName))
      );
    }
    return normalizeForSort(left.playerName).localeCompare(normalizeForSort(right.playerName));
  });
  return next;
};

const compareAutopickCandidates = (
  left: DraftDetail["availablePlayers"][number],
  right: DraftDetail["availablePlayers"][number],
): number => {
  const leftAverage = left.analytics?.averageFantasyPoints ?? Number.NEGATIVE_INFINITY;
  const rightAverage = right.analytics?.averageFantasyPoints ?? Number.NEGATIVE_INFINITY;
  if (rightAverage !== leftAverage) {
    return rightAverage - leftAverage;
  }
  const leftGames = left.analytics?.gamesPlayed ?? 0;
  const rightGames = right.analytics?.gamesPlayed ?? 0;
  if (rightGames !== leftGames) {
    return rightGames - leftGames;
  }
  const leftWinRate = left.analytics?.winRate ?? Number.NEGATIVE_INFINITY;
  const rightWinRate = right.analytics?.winRate ?? Number.NEGATIVE_INFINITY;
  if (rightWinRate !== leftWinRate) {
    return rightWinRate - leftWinRate;
  }
  return normalizeForSort(left.playerName).localeCompare(normalizeForSort(right.playerName));
};

const queueStorageKeyFor = (draftId: number, userId: string): string =>
  `draft-room-queue-v1:${draftId}:${userId}`;

const DraftClockBadge = ({
  deadlineIso,
  pickSeconds,
  draftStatus,
  serverOffsetMs,
  size = "md",
  centerImageUrl = null,
  centerFallbackLabel = null,
  centerImageAlt = "On clock avatar",
  preferCenterFallbackLabel = false,
  showCountdownBelow = false,
}: {
  deadlineIso: string | null;
  pickSeconds: number;
  draftStatus: DraftStatus | null;
  serverOffsetMs: number;
  size?: "md" | "sm";
  centerImageUrl?: string | null;
  centerFallbackLabel?: string | null;
  centerImageAlt?: string;
  preferCenterFallbackLabel?: boolean;
  showCountdownBelow?: boolean;
}) => {
  const ringRef = useRef<HTMLDivElement | null>(null);
  const [countdownLabel, setCountdownLabel] = useState(() =>
    formatCountdown(deadlineIso, Date.now() + serverOffsetMs),
  );

  useEffect(() => {
    const ringElement = ringRef.current;
    const updateLabel = (nowMs: number) => {
      setCountdownLabel((previous) => {
        const next = formatCountdown(deadlineIso, nowMs);
        return next === previous ? previous : next;
      });
    };

    if (!deadlineIso || draftStatus !== "live") {
      const nowMs = Date.now() + serverOffsetMs;
      updateLabel(nowMs);
      if (ringElement) {
        ringElement.style.background = buildClockRingGradient(0, CLOCK_RING_NEUTRAL_PALETTE);
        ringElement.style.borderColor = CLOCK_RING_NEUTRAL_PALETTE.border;
      }
      return;
    }

    const deadlineMs = new Date(deadlineIso).getTime();
    const totalMs = Math.max(1, pickSeconds * 1000);
    let rafId: number | null = null;
    let lastPaintNowMs = 0;

    const paint = () => {
      const nowMs = Date.now() + serverOffsetMs;
      const remainingMs = Math.max(0, deadlineMs - nowMs);
      const progressPercent = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));

      if (ringElement && (nowMs - lastPaintNowMs >= 33 || remainingMs <= 0)) {
        const palette = clockRingPaletteForProgress(progressPercent);
        ringElement.style.background = buildClockRingGradient(progressPercent, palette);
        ringElement.style.borderColor = palette.border;
        lastPaintNowMs = nowMs;
      }

      updateLabel(nowMs);

      if (remainingMs <= 0) {
        return;
      }

      rafId = window.requestAnimationFrame(paint);
    };

    paint();

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [deadlineIso, draftStatus, pickSeconds, serverOffsetMs]);

  const outerSizeClass = size === "sm" ? "h-11 w-11" : "h-14 w-14";
  const innerSizeClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
  const countdownTextClass = size === "sm" ? "text-[11px]" : "text-xs";

  return (
    <div className={`grid justify-items-center ${showCountdownBelow ? "gap-1.5" : ""}`}>
      <div
        ref={ringRef}
        className={`grid ${outerSizeClass} place-items-center rounded-full border`}
        style={{
          background: buildClockRingGradient(0, CLOCK_RING_NEUTRAL_PALETTE),
          borderColor: CLOCK_RING_NEUTRAL_PALETTE.border,
        }}
      >
        <div className={`grid ${innerSizeClass} place-items-center overflow-hidden rounded-full bg-content1 font-semibold`}>
          {centerImageUrl ? (
            <Image
              alt={centerImageAlt}
              className="h-full w-full object-cover"
              height={40}
              src={centerImageUrl}
              width={40}
            />
          ) : showCountdownBelow || preferCenterFallbackLabel ? (
            <span className={`${countdownTextClass} font-bold uppercase tracking-wide text-white/90`}>
              {centerFallbackLabel ?? "??"}
            </span>
          ) : (
            <span className={countdownTextClass}>{countdownLabel}</span>
          )}
        </div>
      </div>
      {showCountdownBelow ? (
        <p className={`mono-points ${countdownTextClass} font-semibold tabular-nums text-white/90`}>
          {countdownLabel}
        </p>
      ) : null}
    </div>
  );
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
  const [pendingManualDraftPlayerName, setPendingManualDraftPlayerName] = useState<string | null>(null);
  const [readyPending, setReadyPending] = useState(false);
  const [pickQueue, setPickQueue] = useState<string[]>([]);
  const [isQueueHydrated, setIsQueueHydrated] = useState(false);
  const [draggedQueueIndex, setDraggedQueueIndex] = useState<number | null>(null);
  const [selectedPlayerName, setSelectedPlayerName] = useState<string | null>(null);
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [showNeededRolesOnly, setShowNeededRolesOnly] = useState(false);
  const [playerSort, setPlayerSort] = useState<PlayerSortKey>("rank");
  const [mobileLiveTab, setMobileLiveTab] = useState("players");
  const [isDesktopChatCollapsed, setIsDesktopChatCollapsed] = useState(true);
  const [showDraftSettings, setShowDraftSettings] = useState(false);
  const [isCommissionerDrawerOpen, setIsCommissionerDrawerOpen] = useState(false);
  const [settings, setSettings] = useState<DraftRoomSettings>(DEFAULT_DRAFT_ROOM_SETTINGS);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [toastNotices, setToastNotices] = useState<ToastNotice[]>([]);
  const [, setSystemFeedEvents] = useState<DraftSystemFeedEvent[]>([]);
  const [clientNowMs, setClientNowMs] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [showExpandedPanels, setShowExpandedPanels] = useState(false);
  const [isPlayerDetailDrawerOpen, setIsPlayerDetailDrawerOpen] = useState(false);
  const [isQueueDrawerOpen, setIsQueueDrawerOpen] = useState(false);
  const [isMobileQueueSheetOpen, setIsMobileQueueSheetOpen] = useState(false);
  const [timelineHighlightPick, setTimelineHighlightPick] = useState<number | null>(null);
  const [topStripHighlightPick, setTopStripHighlightPick] = useState<number | null>(null);
  const [showStatusDetails, setShowStatusDetails] = useState(false);
  const [isFormatPopoverOpen, setIsFormatPopoverOpen] = useState(false);
  const [openChampionPopoverKey, setOpenChampionPopoverKey] = useState<string | null>(null);
  const [brokenChampionIconUrls, setBrokenChampionIconUrls] = useState<Set<string>>(
    () => new Set(),
  );
  const [realtimeChannelVersion, setRealtimeChannelVersion] = useState(0);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [timeoutOutcomeMessage, setTimeoutOutcomeMessage] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const latestToastIdRef = useRef(0);
  const latestSystemFeedEventIdRef = useRef(0);
  const previousConnectionStatusRef = useRef<string | null>(null);
  const previousDraftSnapshotRef = useRef<{
    status: DraftStatus | null;
    pickCount: number;
    onClockUserId: string | null;
    picksUntilTurn: number | null;
  } | null>(null);
  const autoPickAttemptedForPickRef = useRef<number | null>(null);
  const lastPlayerTapRef = useRef<{ playerName: string; atMs: number } | null>(null);
  const loadDraftInFlightRef = useRef(false);
  const draftRefreshTimerRef = useRef<number | null>(null);
  const mobilePlayerSheetTouchStartYRef = useRef<number | null>(null);
  const timeoutExpectedPickRef = useRef<number | null>(null);
  const reconnectStartedAtMsRef = useRef<number | null>(null);
  const lastRealtimeSyncToastAtMsRef = useRef<number>(0);
  const reconnectRetryTimerRef = useRef<number | null>(null);
  const previousAutopickLockedRef = useRef<boolean | null>(null);
  const lastStalenessBucketRef = useRef<number | null>(null);
  const clientMetricsQueueRef = useRef<DraftClientMetricEvent[]>([]);
  const clientMetricsFlushInFlightRef = useRef(false);
  const autoPickAutoEnabledForPickRef = useRef<string | null>(null);
  const [lastDraftSyncMs, setLastDraftSyncMs] = useState(() => Date.now());

  const applyDraft = useCallback((nextDraft: DraftDetail) => {
    setDraft(nextDraft);
    setLastDraftSyncMs(Date.now());
    const serverNowMs = new Date(nextDraft.serverNow).getTime();
    if (Number.isFinite(serverNowMs)) {
      setServerOffsetMs(serverNowMs - Date.now());
    }
  }, []);

  const dismissToast = useCallback((toastId: number) => {
    setToastNotices((prev) => prev.filter((entry) => entry.id !== toastId));
  }, []);

  const markChampionIconUrlBroken = useCallback((url: string) => {
    setBrokenChampionIconUrls((current) => {
      if (current.has(url)) {
        return current;
      }
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }, []);

  const pushToast = useCallback((message: string) => {
    const id = latestToastIdRef.current + 1;
    latestToastIdRef.current = id;
    setToastNotices((prev) => [...prev, { id, message }].slice(-4));
    window.setTimeout(() => {
      dismissToast(id);
    }, TOAST_DURATION_MS);
  }, [dismissToast]);

  const pushSystemFeedEvent = useCallback((label: string, overallPick?: number) => {
    const id = latestSystemFeedEventIdRef.current + 1;
    latestSystemFeedEventIdRef.current = id;
    const createdAtMs = Date.now();
    setSystemFeedEvents((previous) =>
      [...previous, { id, label, overallPick, createdAtMs }].slice(-60),
    );
  }, []);

  const queueClientMetric = useCallback(
    (
      metricName: DraftClientMetricName,
      metricValue: number,
      metadata?: Record<string, unknown>,
    ) => {
      if (!Number.isFinite(metricValue)) {
        return;
      }
      const normalizedValue = Math.max(
        0,
        Math.min(Math.floor(metricValue), DRAFT_CLIENT_METRICS_MAX_VALUE),
      );
      if (normalizedValue < 1) {
        return;
      }
      clientMetricsQueueRef.current.push({
        metricName,
        metricValue: normalizedValue,
        metadata,
      });
      if (clientMetricsQueueRef.current.length > DRAFT_CLIENT_METRICS_MAX_QUEUE) {
        clientMetricsQueueRef.current = clientMetricsQueueRef.current.slice(
          clientMetricsQueueRef.current.length - DRAFT_CLIENT_METRICS_MAX_QUEUE,
        );
      }
    },
    [],
  );

  const flushClientMetrics = useCallback(async () => {
    if (clientMetricsFlushInFlightRef.current) {
      return;
    }
    if (clientMetricsQueueRef.current.length < 1) {
      return;
    }

    const batch = clientMetricsQueueRef.current.slice(0, DRAFT_CLIENT_METRICS_MAX_BATCH);
    clientMetricsQueueRef.current = clientMetricsQueueRef.current.slice(batch.length);
    clientMetricsFlushInFlightRef.current = true;

    try {
      const response = await fetch("/api/drafts/metrics", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ events: batch }),
        keepalive: true,
      });
      if (!response.ok) {
        throw new Error("Unable to record draft metrics.");
      }
    } catch {
      clientMetricsQueueRef.current = [...batch, ...clientMetricsQueueRef.current].slice(
        0,
        DRAFT_CLIENT_METRICS_MAX_QUEUE,
      );
    } finally {
      clientMetricsFlushInFlightRef.current = false;
    }
  }, []);

  const trackDraftEvent = useCallback(
    (event: string, payload: Record<string, unknown> = {}) => {
      const detail = {
        event,
        payload,
        draftId,
        occurredAt: new Date().toISOString(),
      };
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("draft-room-analytics", { detail }));
      }
      if (process.env.NODE_ENV !== "production") {
        // Keep local instrumentation visible during development and QA.
        console.info("[draft-room]", detail);
      }
    },
    [draftId],
  );

  const enableAutopickAfterTimeout = useCallback(
    ({
      expectedPick,
      outcome,
      source,
    }: {
      expectedPick: number;
      outcome: "autopicked" | "skipped";
      source: "live-timeout-resolution" | "draft-sync";
    }) => {
      const marker = `${draftId}:${expectedPick}`;
      if (autoPickAutoEnabledForPickRef.current === marker) {
        return;
      }
      autoPickAutoEnabledForPickRef.current = marker;
      if (settings.autoPickFromQueue) {
        return;
      }
      setSettings((previous) =>
        previous.autoPickFromQueue ? previous : { ...previous, autoPickFromQueue: true },
      );
      pushToast("Autopick enabled after timeout.");
      pushSystemFeedEvent("Autopick enabled after timeout for your next turn.");
      trackDraftEvent("autopick.auto_enabled_after_timeout", {
        outcome,
        expectedPick,
        source,
      });
    },
    [
      draftId,
      pushSystemFeedEvent,
      pushToast,
      settings.autoPickFromQueue,
      trackDraftEvent,
    ],
  );

  const jumpToTimelinePick = useCallback((overallPick: number | null) => {
    if (typeof overallPick !== "number") {
      return;
    }
    setTimelineHighlightPick(overallPick);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`timeline-pick-${overallPick}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }, []);

  const playCue = useCallback(
    (frequency: number, durationMs: number) => {
      if (settings.muted || typeof window === "undefined") {
        return;
      }
      const AudioContextCtor =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      try {
        const audioContext = new AudioContextCtor();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
        gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.05, audioContext.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(
          0.0001,
          audioContext.currentTime + durationMs / 1000,
        );
        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start();
        oscillator.stop(audioContext.currentTime + durationMs / 1000);
      } catch {
        // no-op: audio cue is best effort.
      }
    },
    [settings.muted],
  );

  const loadDraft = useCallback(async () => {
    const startedAt = performance.now();
    let responseStatus = 0;
    let serverTimingTotalMs: number | null = null;
    try {
      const response = await fetch(`/api/drafts/${draftId}`, {
        cache: "no-store",
      });
      responseStatus = response.status;
      serverTimingTotalMs = parseServerTimingTotalMs(response.headers.get("server-timing"));
      const payload = (await response.json()) as DraftDetailResponse;

      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Unable to load draft.");
      }

      applyDraft(payload.draft);
    } finally {
      queueClientMetric("client_draft_refresh_latency_ms", performance.now() - startedAt, {
        statusCode: responseStatus,
        serverTotalMs: serverTimingTotalMs,
        draftId,
      });
    }
  }, [applyDraft, draftId, queueClientMetric]);
  const draftStatus = draft?.status ?? null;

  const requestDraftRefresh = useCallback(async () => {
    if (loadDraftInFlightRef.current) {
      queueClientMetric("client_refresh_retry", 1, { reason: "refresh_in_flight", draftId });
      return;
    }
    loadDraftInFlightRef.current = true;
    try {
      await loadDraft();
    } finally {
      loadDraftInFlightRef.current = false;
    }
  }, [draftId, loadDraft, queueClientMetric]);
  const scheduleDraftRefresh = useCallback(
    (delayMs: number = REALTIME_REFRESH_DEBOUNCE_MS) => {
      if (typeof window === "undefined") {
        return;
      }
      if (draftRefreshTimerRef.current !== null) {
        window.clearTimeout(draftRefreshTimerRef.current);
      }
      draftRefreshTimerRef.current = window.setTimeout(() => {
        draftRefreshTimerRef.current = null;
        void requestDraftRefresh().catch(() => undefined);
      }, Math.max(0, delayMs));
    },
    [requestDraftRefresh],
  );

  useEffect(() => {
    return () => {
      if (draftRefreshTimerRef.current !== null) {
        window.clearTimeout(draftRefreshTimerRef.current);
        draftRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.localStorage.getItem(DRAFT_SETTINGS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<DraftRoomSettings>;
      setSettings((prev) => ({
        muted: typeof parsed.muted === "boolean" ? parsed.muted : prev.muted,
        vibrateOnTurn:
          typeof parsed.vibrateOnTurn === "boolean"
            ? parsed.vibrateOnTurn
            : prev.vibrateOnTurn,
        requirePickConfirm:
          typeof parsed.requirePickConfirm === "boolean"
            ? parsed.requirePickConfirm
            : prev.requirePickConfirm,
        autoPickFromQueue:
          typeof parsed.autoPickFromQueue === "boolean"
            ? parsed.autoPickFromQueue
            : prev.autoPickFromQueue,
      }));
    } catch {
      // no-op: local setting payload can be safely ignored.
    }
  }, []);

  useEffect(() => {
    if (draftStatus === "live" || draftStatus === "paused") {
      setShowExpandedPanels(false);
      return;
    }
    setShowExpandedPanels(true);
  }, [draftId, draftStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(DRAFT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(DRAFT_ROOM_DESKTOP_CHAT_COLLAPSE_KEY);
    if (raw === "true") {
      setIsDesktopChatCollapsed(true);
      return;
    }
    if (raw === "false") {
      setIsDesktopChatCollapsed(false);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      DRAFT_ROOM_DESKTOP_CHAT_COLLAPSE_KEY,
      isDesktopChatCollapsed ? "true" : "false",
    );
  }, [isDesktopChatCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const id = window.setInterval(() => {
      void flushClientMetrics().catch(() => undefined);
    }, DRAFT_CLIENT_METRICS_FLUSH_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void flushClientMetrics().catch(() => undefined);
      }
    };
    const onBeforeUnload = () => {
      void flushClientMetrics().catch(() => undefined);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      void flushClientMetrics().catch(() => undefined);
    };
  }, [flushClientMetrics]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearchTerm(searchInputValue);
    }, 160);
    return () => {
      window.clearTimeout(id);
    };
  }, [searchInputValue]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setIsQueueHydrated(false);
    const storageKey = queueStorageKeyFor(draftId, currentUserId);
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setPickQueue([]);
        setIsQueueHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setPickQueue([]);
        setIsQueueHydrated(true);
        return;
      }
      const normalized = parsed
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry): entry is string => Boolean(entry));
      setPickQueue([...new Set(normalized)]);
      setIsQueueHydrated(true);
    } catch {
      setPickQueue([]);
      setIsQueueHydrated(true);
    }
  }, [currentUserId, draftId]);

  useEffect(() => {
    if (typeof window === "undefined" || !isQueueHydrated) {
      return;
    }
    const storageKey = queueStorageKeyFor(draftId, currentUserId);
    window.localStorage.setItem(storageKey, JSON.stringify(pickQueue));
  }, [currentUserId, draftId, isQueueHydrated, pickQueue]);

  useEffect(() => {
    let canceled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        await requestDraftRefresh();
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
  }, [requestDraftRefresh]);

  useEffect(() => {
    if (!draftStatus) {
      return;
    }
    const intervalMs = draftStatus === "live" ? 3000 : draftStatus === "scheduled" ? 5000 : 10000;
    const id = window.setInterval(() => {
      void requestDraftRefresh().catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [draftStatus, requestDraftRefresh]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let isActive = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const authStateSubscription = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.access_token) {
        return;
      }
      supabase.realtime.setAuth(session.access_token);
    });

    const connectRealtime = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.access_token) {
          supabase.realtime.setAuth(data.session.access_token);
        }
      } catch {
        // no-op: polling fallback still keeps draft state in sync.
      }

      if (!isActive) {
        return;
      }

      channel = supabase
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
            scheduleDraftRefresh();
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
            scheduleDraftRefresh();
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
            if (draftStatus === "live" || draftStatus === "paused" || draftStatus === "completed") {
              return;
            }
            scheduleDraftRefresh(PRESENCE_REFRESH_DEBOUNCE_MS);
          },
        )
        .subscribe((status) => {
          setConnectionStatus(status);
        });
    };

    void connectRealtime();

    return () => {
      isActive = false;
      authStateSubscription.data.subscription.unsubscribe();
      if (channel) {
        void supabase.removeChannel(channel);
      }
    };
  }, [draftId, draftStatus, scheduleDraftRefresh, realtimeChannelVersion]);

  useEffect(() => {
    const previous = previousConnectionStatusRef.current;
    if (previous === null) {
      previousConnectionStatusRef.current = connectionStatus;
      return;
    }
    if (previous === connectionStatus) {
      return;
    }
    if (connectionStatus === "SUBSCRIBED") {
      const reconnectStartedAt = reconnectStartedAtMsRef.current;
      const hadReconnect = typeof reconnectStartedAt === "number";
      if (hadReconnect) {
        trackDraftEvent("reconnect.end", { durationMs: Date.now() - reconnectStartedAt });
      }
      reconnectStartedAtMsRef.current = null;
      if (hadReconnect) {
        pushSystemFeedEvent("Realtime connection restored.");
        const nowMs = Date.now();
        if (nowMs - lastRealtimeSyncToastAtMsRef.current >= REALTIME_SYNC_TOAST_COOLDOWN_MS) {
          pushToast("Synced to live draft.");
          lastRealtimeSyncToastAtMsRef.current = nowMs;
        }
      }
      jumpToTimelinePick(draft?.nextPick?.overallPick ?? null);
    } else if (connectionStatus === "CHANNEL_ERROR" || connectionStatus === "TIMED_OUT") {
      queueClientMetric("client_realtime_disconnect", 1, {
        status: connectionStatus,
        draftId,
      });
      if (reconnectStartedAtMsRef.current === null) {
        reconnectStartedAtMsRef.current = Date.now();
        trackDraftEvent("reconnect.start", { status: connectionStatus });
      }
      const isCurrentUserClocked =
        draft?.status === "live" && draft?.nextPick?.participantUserId === currentUserId;
      if (connectionStatus === "TIMED_OUT" && isCurrentUserClocked && draft?.nextPick?.overallPick) {
        timeoutExpectedPickRef.current = draft.nextPick.overallPick;
        setTimeoutOutcomeMessage(null);
      }
      const degradedReason = connectionStatus.toLowerCase().replace("_", " ");
      const pollIntervalMs =
        draft?.status === "live" ? 3000 : draft?.status === "scheduled" ? 5000 : 10000;
      const readOnlyStaleSeconds = Math.max(
        REALTIME_READ_ONLY_MIN_STALE_SECONDS,
        Math.ceil((pollIntervalMs * REALTIME_READ_ONLY_STALE_MULTIPLIER) / 1000),
      );
      const shouldEnforceReadOnly =
        (Date.now() - lastDraftSyncMs) / 1000 >= readOnlyStaleSeconds;
      const degradedMessage = shouldEnforceReadOnly
        ? isCurrentUserClocked
          ? settings.autoPickFromQueue
            ? `Realtime degraded: ${degradedReason}. Read-only mode enabled. If your clock expires, timeout fallback uses queue target then server board order.`
            : `Realtime degraded: ${degradedReason}. Read-only mode enabled. If your clock expires, fallback pick rules apply.`
          : `Realtime degraded: ${degradedReason}. Read-only mode enabled.`
        : `Realtime degraded: ${degradedReason}. Polling fallback active until websocket recovers.`;
      pushSystemFeedEvent(
        degradedMessage,
        draft?.nextPick?.overallPick ?? undefined,
      );
    } else if (connectionStatus === "CLOSED") {
      queueClientMetric("client_realtime_disconnect", 1, {
        status: connectionStatus,
        draftId,
      });
      if (reconnectStartedAtMsRef.current === null) {
        reconnectStartedAtMsRef.current = Date.now();
        trackDraftEvent("reconnect.start", { status: connectionStatus });
      }
      pushSystemFeedEvent("Realtime channel closed.");
    }
    previousConnectionStatusRef.current = connectionStatus;
  }, [
    connectionStatus,
    currentUserId,
    draftId,
    draft?.nextPick?.participantUserId,
    draft?.nextPick?.overallPick,
    draft?.status,
    jumpToTimelinePick,
    lastDraftSyncMs,
    pushSystemFeedEvent,
    pushToast,
    queueClientMetric,
    settings.autoPickFromQueue,
    trackDraftEvent,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (connectionStatus === "SUBSCRIBED" || connectionStatus === "connecting") {
      if (reconnectRetryTimerRef.current !== null) {
        window.clearTimeout(reconnectRetryTimerRef.current);
        reconnectRetryTimerRef.current = null;
      }
      return;
    }
    const shouldRetry =
      connectionStatus === "CHANNEL_ERROR" ||
      connectionStatus === "TIMED_OUT" ||
      connectionStatus === "CLOSED";
    if (!shouldRetry || reconnectRetryTimerRef.current !== null) {
      return;
    }
    reconnectRetryTimerRef.current = window.setTimeout(() => {
      reconnectRetryTimerRef.current = null;
      setRealtimeChannelVersion((version) => version + 1);
    }, REALTIME_RESUBSCRIBE_DELAY_MS);
  }, [connectionStatus]);

  useEffect(() => {
    return () => {
      if (reconnectRetryTimerRef.current !== null) {
        window.clearTimeout(reconnectRetryTimerRef.current);
        reconnectRetryTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const expectedPick = timeoutExpectedPickRef.current;
    if (!draft || expectedPick === null) {
      return;
    }
    const timeoutPick = draft.picks.find((pick) => pick.overallPick === expectedPick) ?? null;
    const timeoutEventForExpectedPick =
      draft.timeoutEvents.find(
        (event) => event.overallPick === expectedPick && event.participantUserId === currentUserId,
      ) ?? null;
    const movedPastExpectedPick = (draft.nextPick?.overallPick ?? 0) > expectedPick;
    if (!timeoutPick && !timeoutEventForExpectedPick && !movedPastExpectedPick) {
      return;
    }
    const timedOutCurrentUser =
      timeoutEventForExpectedPick?.outcome === "autopicked" ||
      (timeoutPick?.participantUserId === currentUserId && isTimeoutAutopickPick(timeoutPick));
    const skippedCurrentUser = timeoutEventForExpectedPick?.outcome === "skipped";
    const manualCurrentUserPickResolved =
      timeoutPick?.participantUserId === currentUserId && !timedOutCurrentUser && !skippedCurrentUser;
    if (manualCurrentUserPickResolved) {
      timeoutExpectedPickRef.current = null;
      return;
    }

    if (timedOutCurrentUser) {
      const timeoutPlayerName =
        timeoutPick?.playerName ??
        timeoutEventForExpectedPick?.pickedTeamName ??
        "Best Available";
      setTimeoutOutcomeMessage(`Timed out -> Autopicked: ${timeoutPlayerName}`);
      pushSystemFeedEvent(`Timed out. Autopicked: ${timeoutPlayerName}.`, expectedPick);
      trackDraftEvent("timeout.outcome", {
        outcome: "autopicked",
        playerName: timeoutPlayerName,
        overallPick: expectedPick,
      });
    } else {
      setTimeoutOutcomeMessage("Timed out -> Skipped");
      pushSystemFeedEvent("Timed out. Pick was skipped.");
      trackDraftEvent("timeout.outcome", { outcome: "skipped", expectedPick });
    }
    enableAutopickAfterTimeout({
      expectedPick,
      outcome: timedOutCurrentUser ? "autopicked" : "skipped",
      source: "live-timeout-resolution",
    });
    setPendingManualDraftPlayerName(null);
    setSelectedPlayerName(null);
    setSelectionNotice(timeoutPick ? "Pick locked by server outcome." : "Clock expired before confirmation.");
    jumpToTimelinePick(timeoutPick?.overallPick ?? expectedPick);
    timeoutExpectedPickRef.current = null;
  }, [
    currentUserId,
    draft,
    enableAutopickAfterTimeout,
    jumpToTimelinePick,
    pushSystemFeedEvent,
    trackDraftEvent,
  ]);

  useEffect(() => {
    if (!timeoutOutcomeMessage) {
      return;
    }
    if (timeoutOutcomeMessage.startsWith("Clock expired ->")) {
      return;
    }
    const id = window.setTimeout(() => {
      setTimeoutOutcomeMessage(null);
    }, 10000);
    return () => {
      window.clearTimeout(id);
    };
  }, [timeoutOutcomeMessage]);

  useEffect(() => {
    if (!selectionNotice) {
      return;
    }
    const id = window.setTimeout(() => {
      setSelectionNotice(null);
    }, 7000);
    return () => {
      window.clearTimeout(id);
    };
  }, [selectionNotice]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => {
      setIsMobileViewport(mediaQuery.matches);
    };
    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);
    return () => {
      mediaQuery.removeEventListener("change", syncViewport);
    };
  }, []);

  useEffect(() => {
    const isCurrentUserClocked =
      draftStatus === "live" && draft?.nextPick?.participantUserId === currentUserId;
    const hasLiveDraftClock =
      draftStatus === "live" && Boolean(draft?.currentPickDeadlineAt);
    const shouldTick =
      hasLiveDraftClock ||
      isCurrentUserClocked ||
      connectionStatus !== "SUBSCRIBED" ||
      Boolean(timeoutOutcomeMessage);
    if (!shouldTick) {
      setClientNowMs(Date.now());
      return;
    }
    // Keep a stable one-second cadence so large live-draft panes do not rerender at sub-second frequency.
    const intervalMs = 1000;
    const id = window.setInterval(() => {
      setClientNowMs(Date.now());
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [
    connectionStatus,
    currentUserId,
    draft?.currentPickDeadlineAt,
    draft?.nextPick?.participantUserId,
    draftStatus,
    timeoutOutcomeMessage,
  ]);

  useEffect(() => {
    if (!isMobileViewport) {
      setIsMobileQueueSheetOpen(false);
      return;
    }
    if (!(draftStatus === "live" || draftStatus === "paused")) {
      setIsMobileQueueSheetOpen(false);
    }
  }, [draftStatus, isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport || !isMobileQueueSheetOpen) {
      return;
    }
    setSelectedPlayerName(null);
  }, [isMobileQueueSheetOpen, isMobileViewport]);

  const sendPresence = useCallback(
    async ({ ready }: { ready?: boolean } = {}) => {
      const startedAt = performance.now();
      let responseStatus = 0;
      let serverTimingTotalMs: number | null = null;
      try {
        const response = await fetch(`/api/drafts/${draftId}/presence`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(typeof ready === "boolean" ? { ready } : {}),
        });
        responseStatus = response.status;
        serverTimingTotalMs = parseServerTimingTotalMs(response.headers.get("server-timing"));

        const payload = (await response.json()) as DraftPresenceResponse;
        if (!response.ok) {
          throw new Error(payload.error ?? "Unable to update presence.");
        }

        if (payload.draft) {
          applyDraft(payload.draft);
          return;
        }

        const serverNowMs = payload.serverNow ? new Date(payload.serverNow).getTime() : Number.NaN;
        if (Number.isFinite(serverNowMs)) {
          setServerOffsetMs(serverNowMs - Date.now());
        }
      } finally {
        queueClientMetric("client_draft_presence_latency_ms", performance.now() - startedAt, {
          statusCode: responseStatus,
          serverTotalMs: serverTimingTotalMs,
          mode: typeof ready === "boolean" ? "ready_toggle" : "heartbeat",
          draftId,
        });
      }
    },
    [applyDraft, draftId, queueClientMetric],
  );

  const isCurrentUserParticipant = Boolean(
    draft?.participantPresence.some((entry) => entry.userId === currentUserId),
  );
  const participantsByPosition = useMemo(
    () => [...(draft?.participants ?? [])].sort((a, b) => a.draftPosition - b.draftPosition),
    [draft?.participants],
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
  const assignedParticipantByOverallPick = useMemo(() => {
    const map = new Map<number, DraftDetail["participants"][number]>();
    const participantCount = participantsByPosition.length;
    if (participantCount < 2) {
      return map;
    }
    for (const pick of draft?.picks ?? []) {
      if (pick.overallPick < 1) {
        continue;
      }
      const slot = getPickSlot(participantCount, pick.overallPick);
      const assignedParticipant = participantsByPosition[slot.participantIndex];
      if (assignedParticipant) {
        map.set(pick.overallPick, assignedParticipant);
      }
    }
    return map;
  }, [draft?.picks, participantsByPosition]);
  const picksByRoundAndParticipantUserId = useMemo(() => {
    const map = new Map<string, DraftDetail["picks"][number]>();
    for (const pick of draft?.picks ?? []) {
      const assignedParticipant = assignedParticipantByOverallPick.get(pick.overallPick);
      const participantUserId = assignedParticipant?.userId ?? pick.participantUserId;
      map.set(`${pick.roundNumber}::${participantUserId}`, pick);
    }
    return map;
  }, [assignedParticipantByOverallPick, draft?.picks]);
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
        isScarce: false,
      },
      ...PRIMARY_ROLE_FILTERS.map((role) => {
        const count = roleCounts.get(role) ?? 0;
        return {
          value: role,
          label: role,
          count,
          isScarce: count > 0 && count <= ROLE_SCARCITY_THRESHOLD,
        };
      }),
      ...(roleCounts.get(UNASSIGNED_ROLE)
        ? [
            {
              value: UNASSIGNED_ROLE,
              label: "N/A",
              count: roleCounts.get(UNASSIGNED_ROLE) ?? 0,
              isScarce: false,
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
  const sortedAvailablePlayers = useMemo(
    () => sortAvailablePlayers(filteredAvailablePlayers, playerSort),
    [filteredAvailablePlayers, playerSort],
  );

  const onClockUserId = draft?.nextPick?.participantUserId ?? null;
  const canCurrentUserPick =
    Boolean(draft?.status === "live") &&
    Boolean(draft?.nextPick) &&
    onClockUserId === currentUserId;
  const canEditPickQueue = isCurrentUserParticipant && draft?.status !== "completed";
  const secondsSinceLastSync = Math.max(0, Math.floor((clientNowMs - lastDraftSyncMs) / 1000));
  const realtimePollIntervalMs =
    draft?.status === "live" ? 3000 : draft?.status === "scheduled" ? 5000 : 10000;
  const realtimeReadOnlyStaleSeconds = Math.max(
    REALTIME_READ_ONLY_MIN_STALE_SECONDS,
    Math.ceil((realtimePollIntervalMs * REALTIME_READ_ONLY_STALE_MULTIPLIER) / 1000),
  );
  const isRealtimeReadOnly =
    connectionStatus !== "SUBSCRIBED" && secondsSinceLastSync >= realtimeReadOnlyStaleSeconds;
  const canQueueActions = canEditPickQueue && !isRealtimeReadOnly;
  const canDraftActions = canCurrentUserPick && !isRealtimeReadOnly;

  useEffect(() => {
    if (!canCurrentUserPick) {
      return;
    }
    const currentPick = draft?.nextPick?.overallPick ?? null;
    if (!currentPick) {
      return;
    }
    timeoutExpectedPickRef.current = currentPick;
  }, [canCurrentUserPick, draft?.nextPick?.overallPick]);

  const connectionLabel = connectionStatus.toLowerCase().replaceAll("_", " ");
  const currentPresence = presenceByUserId.get(currentUserId) ?? null;
  const availablePlayersByName = useMemo(
    () => new Map((draft?.availablePlayers ?? []).map((player) => [player.playerName, player])),
    [draft?.availablePlayers],
  );
  const playerImageLookup = useMemo(() => {
    const exactByName = new Map<string, string | null>();
    const fallbackByName = new Map<string, string>();
    for (const player of draft?.playerPool ?? []) {
      const imageUrl = player.playerImageUrl ?? null;
      exactByName.set(player.playerName, imageUrl);
      if (!imageUrl) {
        continue;
      }
      const normalizedName = normalizePlayerLookupKey(player.playerName);
      if (normalizedName && !fallbackByName.has(normalizedName)) {
        fallbackByName.set(normalizedName, imageUrl);
      }
      const baseName = stripTrailingTeamSuffix(player.playerName);
      const normalizedBaseName = normalizePlayerLookupKey(baseName);
      if (normalizedBaseName && !fallbackByName.has(normalizedBaseName)) {
        fallbackByName.set(normalizedBaseName, imageUrl);
      }
    }
    return {
      exactByName,
      fallbackByName,
    };
  }, [draft?.playerPool]);
  const pickPlayerImageUrl = useCallback(
    (pick: DraftDetail["picks"][number] | null | undefined): string | null => {
      if (!pick) {
        return null;
      }
      if (pick.playerImageUrl) {
        return pick.playerImageUrl;
      }
      const exactImage = playerImageLookup.exactByName.get(pick.playerName);
      if (exactImage) {
        return exactImage;
      }
      const normalizedPickName = normalizePlayerLookupKey(pick.playerName);
      const normalizedPickBaseName = normalizePlayerLookupKey(stripTrailingTeamSuffix(pick.playerName));
      return (
        playerImageLookup.fallbackByName.get(normalizedPickName) ??
        playerImageLookup.fallbackByName.get(normalizedPickBaseName) ??
        null
      );
    },
    [playerImageLookup],
  );
  const queuedPlayers = useMemo(
    () =>
      pickQueue
        .map((name) => availablePlayersByName.get(name))
        .filter((player): player is DraftDetail["availablePlayers"][number] => Boolean(player)),
    [availablePlayersByName, pickQueue],
  );
  const queuedPlayerNameSet = useMemo(() => new Set(pickQueue), [pickQueue]);
  const selectedPlayer = selectedPlayerName
    ? availablePlayersByName.get(selectedPlayerName) ?? null
    : null;
  const isSelectedPlayerQueued = selectedPlayer
    ? queuedPlayerNameSet.has(selectedPlayer.playerName)
    : false;

  useEffect(() => {
    setOpenChampionPopoverKey(null);
  }, [isPlayerDetailDrawerOpen, selectedPlayerName]);

  useEffect(() => {
    const previous = previousAutopickLockedRef.current;
    if (previous === null) {
      previousAutopickLockedRef.current = isRealtimeReadOnly;
      return;
    }
    if (previous !== isRealtimeReadOnly) {
      trackDraftEvent("autopick.locked_state", {
        locked: isRealtimeReadOnly,
        connectionStatus,
        enabled: settings.autoPickFromQueue,
      });
    }
    previousAutopickLockedRef.current = isRealtimeReadOnly;
  }, [connectionStatus, isRealtimeReadOnly, settings.autoPickFromQueue, trackDraftEvent]);

  useEffect(() => {
    if (!isRealtimeReadOnly) {
      lastStalenessBucketRef.current = null;
      return;
    }
    const bucket = Math.floor(secondsSinceLastSync / 5);
    if (bucket <= 0 || lastStalenessBucketRef.current === bucket) {
      return;
    }
    lastStalenessBucketRef.current = bucket;
    trackDraftEvent("latency.staleness_warning", {
      secondsSinceLastSync,
      connectionStatus,
    });
  }, [connectionStatus, isRealtimeReadOnly, secondsSinceLastSync, trackDraftEvent]);

  const userPicks = useMemo(
    () =>
      (draft?.picks ?? []).filter((pick) => {
        const assignedParticipant = assignedParticipantByOverallPick.get(pick.overallPick);
        const participantUserId = assignedParticipant?.userId ?? pick.participantUserId;
        return participantUserId === currentUserId;
      }),
    [assignedParticipantByOverallPick, currentUserId, draft?.picks],
  );
  const latestTimeoutEventForCurrentUser = useMemo(() => {
    let latest: DraftDetail["timeoutEvents"][number] | null = null;
    for (const event of draft?.timeoutEvents ?? []) {
      if (event.participantUserId !== currentUserId) {
        continue;
      }
      if (!latest || event.overallPick > latest.overallPick) {
        latest = event;
      }
    }
    return latest;
  }, [currentUserId, draft?.timeoutEvents]);
  useEffect(() => {
    if (draft?.status !== "live" || !latestTimeoutEventForCurrentUser) {
      return;
    }
    enableAutopickAfterTimeout({
      expectedPick: latestTimeoutEventForCurrentUser.overallPick,
      outcome: latestTimeoutEventForCurrentUser.outcome,
      source: "draft-sync",
    });
  }, [draft?.status, enableAutopickAfterTimeout, latestTimeoutEventForCurrentUser]);
  const boardRoundNumbers = useMemo(
    () => Array.from({ length: draft?.roundCount ?? 0 }, (_, roundOffset) => roundOffset + 1),
    [draft?.roundCount],
  );
  const userRoleSet = useMemo(
    () => new Set(userPicks.map((pick) => normalizeRole(pick.playerRole))),
    [userPicks],
  );
  const queuedEligiblePlayers = useMemo(
    () =>
      queuedPlayers.filter((player) => {
        const normalizedRole = normalizeRole(player.playerRole);
        if (normalizedRole === UNASSIGNED_ROLE) {
          return false;
        }
        return !userRoleSet.has(normalizedRole);
      }),
    [queuedPlayers, userRoleSet],
  );
  const nextQueuedEligiblePlayerName = queuedEligiblePlayers[0]?.playerName ?? null;
  const rosterNeeds = useMemo(
    () => PRIMARY_ROLE_FILTERS.filter((role) => !userRoleSet.has(role)),
    [userRoleSet],
  );
  const rosterSlots = useMemo(() => {
    const byRole = new Map<string, DraftDetail["picks"][number]>();
    const overflow: DraftDetail["picks"][number][] = [];
    for (const pick of userPicks) {
      const normalizedRole = normalizeRole(pick.playerRole);
      if (PRIMARY_ROLE_FILTERS.includes(normalizedRole as (typeof PRIMARY_ROLE_FILTERS)[number])) {
        if (!byRole.has(normalizedRole)) {
          byRole.set(normalizedRole, pick);
        } else {
          overflow.push(pick);
        }
      } else {
        overflow.push(pick);
      }
    }
    return {
      byRole,
      overflow,
    };
  }, [userPicks]);
  const bestNeedSuggestion = useMemo(() => {
    for (const neededRole of rosterNeeds) {
      const candidate = sortedAvailablePlayers.find(
        (player) => normalizeRole(player.playerRole) === neededRole,
      );
      if (candidate) {
        return {
          role: neededRole,
          playerName: candidate.playerName,
        };
      }
    }
    return null;
  }, [rosterNeeds, sortedAvailablePlayers]);
  const rosterNeedsSet = useMemo<Set<string>>(() => new Set(rosterNeeds), [rosterNeeds]);
  const displayAvailablePlayers = useMemo(() => {
    if (!showNeededRolesOnly || rosterNeedsSet.size === 0) {
      return sortedAvailablePlayers;
    }
    return sortedAvailablePlayers.filter((player) => rosterNeedsSet.has(normalizeRole(player.playerRole)));
  }, [rosterNeedsSet, showNeededRolesOnly, sortedAvailablePlayers]);
  const quickQueueSuggestions = useMemo(() => {
    const suggestions: Array<{ label: string; playerName: string }> = [];
    const seen = new Set<string>();
    const queueSet = queuedPlayerNameSet;

    for (const role of rosterNeeds) {
      const candidate = sortedAvailablePlayers.find(
        (player) => normalizeRole(player.playerRole) === role && !queueSet.has(player.playerName),
      );
      if (!candidate || seen.has(candidate.playerName)) {
        continue;
      }
      suggestions.push({
        label: `Best ${role}`,
        playerName: candidate.playerName,
      });
      seen.add(candidate.playerName);
      if (suggestions.length >= 3) {
        return suggestions;
      }
    }

    for (const candidate of sortedAvailablePlayers) {
      if (queueSet.has(candidate.playerName) || seen.has(candidate.playerName)) {
        continue;
      }
      suggestions.push({
        label: `Best ${formatRoleLabel(candidate.playerRole)}`,
        playerName: candidate.playerName,
      });
      seen.add(candidate.playerName);
      if (suggestions.length >= 3) {
        break;
      }
    }
    return suggestions;
  }, [queuedPlayerNameSet, rosterNeeds, sortedAvailablePlayers]);
  const hasSearchFilter = searchInputValue.trim().length > 0;
  const hasRoleFilter = roleFilter !== "ALL";
  const activePlayerFilterCount =
    Number(hasSearchFilter) + Number(hasRoleFilter) + Number(showNeededRolesOnly);
  const hasAnyPlayerFilter = activePlayerFilterCount > 0;
  const resetPlayerFilters = useCallback(() => {
    setSearchInputValue("");
    setSearchTerm("");
    setRoleFilter("ALL");
    setShowNeededRolesOnly(false);
  }, []);
  const applyRoleFilter = useCallback((nextRole: string) => {
    setRoleFilter(nextRole);
    if (nextRole !== "ALL") {
      setPlayerSort("pos");
    }
  }, []);

  const picksUntilCurrentUser = useMemo(() => {
    if (!draft?.nextPick) {
      return null;
    }
    if (canCurrentUserPick) {
      return 0;
    }
    const participantCount = participantsByPosition.length;
    if (participantCount < 2) {
      return null;
    }

    for (let overallPick = draft.nextPick.overallPick; overallPick <= draft.totalPickCount; overallPick += 1) {
      const participantIndex = getPickSlot(participantCount, overallPick).participantIndex;
      const participant = participantsByPosition[participantIndex];
      if (participant?.userId === currentUserId) {
        return overallPick - draft.nextPick.overallPick;
      }
    }
    return null;
  }, [canCurrentUserPick, currentUserId, draft, participantsByPosition]);

  const averagePickMs = useMemo(() => {
    const defaultMs = Math.max(4000, (draft?.pickSeconds ?? 75) * 1000);
    const picks = draft?.picks ?? [];
    if (picks.length < 2) {
      return defaultMs;
    }
    const recent = picks.slice(-10);
    const deltasMs: number[] = [];
    for (let index = 1; index < recent.length; index += 1) {
      const previousMs = new Date(recent[index - 1].pickedAt).getTime();
      const currentMs = new Date(recent[index].pickedAt).getTime();
      if (!Number.isFinite(previousMs) || !Number.isFinite(currentMs)) {
        continue;
      }
      const deltaMs = currentMs - previousMs;
      if (deltaMs > 0) {
        deltasMs.push(deltaMs);
      }
    }
    if (deltasMs.length === 0) {
      return defaultMs;
    }
    const averageMs = deltasMs.reduce((sum, value) => sum + value, 0) / deltasMs.length;
    return Math.max(4000, Math.min(defaultMs * 1.4, averageMs));
  }, [draft?.pickSeconds, draft?.picks]);
  const currentPickRemainingMs = useMemo(() => {
    if (!draft?.currentPickDeadlineAt) {
      return null;
    }
    const deadlineMs = new Date(draft.currentPickDeadlineAt).getTime();
    if (!Number.isFinite(deadlineMs)) {
      return null;
    }
    return deadlineMs - (clientNowMs + serverOffsetMs);
  }, [clientNowMs, draft?.currentPickDeadlineAt, serverOffsetMs]);
  const liveTimeLeftLabel = useMemo(
    () => formatCountdown(draft?.currentPickDeadlineAt ?? null, clientNowMs + serverOffsetMs),
    [clientNowMs, draft?.currentPickDeadlineAt, serverOffsetMs],
  );
  const topPickStripSlots = useMemo(() => {
    const labelForOffset = (offset: number): string => {
      if (offset === 0) {
        return "Now";
      }
      if (offset < 0) {
        const picksAgo = Math.abs(offset);
        return `${picksAgo} ${picksAgo === 1 ? "pick" : "picks"} ago`;
      }
      if (offset === 1) {
        return "Next";
      }
      return `Next +${offset - 1}`;
    };
    if (!draft || participantsByPosition.length < 1 || draft.totalPickCount < 1) {
          return [] as Array<{
            key: string;
            label: string;
            offset: number;
            slot: {
              overallPick: number;
              roundNumber: number;
              participantDisplayName: string;
              participantTeamName: string | null;
              participantAvatarUrl: string | null;
              pickedPlayerName: string | null;
              pickedPlayerTeam: string | null;
              pickedPlayerRole: string | null;
              pickedPlayerImageUrl: string | null;
              pickedTeamIconUrl: string | null;
        } | null;
      }>;
    }

    const currentOverallPick =
      draft.nextPick?.overallPick ?? (draft.picks.length > 0 ? draft.totalPickCount + 1 : 1);
    const participantCount = participantsByPosition.length;
    const slots: Array<{
      key: string;
      label: string;
      offset: number;
      slot: {
        overallPick: number;
        roundNumber: number;
        participantDisplayName: string;
        participantTeamName: string | null;
        participantAvatarUrl: string | null;
        pickedPlayerName: string | null;
        pickedPlayerTeam: string | null;
        pickedPlayerRole: string | null;
        pickedPlayerImageUrl: string | null;
        pickedTeamIconUrl: string | null;
      } | null;
    }> = [];

    for (const offset of TOP_PICK_STRIP_OFFSETS) {
      const overallPick = currentOverallPick + offset;
      if (overallPick < 1 || overallPick > draft.totalPickCount) {
        continue;
      }
      const slotMeta = getPickSlot(participantCount, overallPick);
      const roundNumber = slotMeta.roundNumber;
      const participantIndex = slotMeta.participantIndex;
      const participant = participantsByPosition[participantIndex];
      if (!participant) {
        slots.push({
          key: `slot-${overallPick}`,
          label: labelForOffset(offset),
          offset,
          slot: null,
        });
        continue;
      }
      const picked = picksByOverallPick.get(overallPick) ?? null;
      slots.push({
        key: `slot-${overallPick}`,
        label: labelForOffset(offset),
        offset,
        slot: {
          overallPick,
          roundNumber,
          participantDisplayName: participant.displayName,
          participantTeamName: participant.teamName,
          participantAvatarUrl: participant.avatarUrl,
          pickedPlayerName: picked?.playerName ?? null,
          pickedPlayerTeam: picked?.playerTeam ?? null,
          pickedPlayerRole: picked?.playerRole ?? null,
          pickedPlayerImageUrl: pickPlayerImageUrl(picked),
          pickedTeamIconUrl: picked?.teamIconUrl ?? null,
        },
      });
    }
    return slots;
  }, [draft, participantsByPosition, pickPlayerImageUrl, picksByOverallPick]);
  const yourNextPickMeta = useMemo(() => {
    if (!draft?.nextPick || typeof picksUntilCurrentUser !== "number") {
      return null;
    }
    if (participantsByPosition.length < 1) {
      return null;
    }
    const overallPick = draft.nextPick.overallPick + picksUntilCurrentUser;
    const roundNumber = Math.ceil(overallPick / participantsByPosition.length);
    const etaMs = picksUntilCurrentUser === 0 ? 0 : picksUntilCurrentUser * averagePickMs;
    return {
      overallPick,
      roundNumber,
      picksAway: picksUntilCurrentUser,
      etaMs,
    };
  }, [averagePickMs, draft?.nextPick, participantsByPosition.length, picksUntilCurrentUser]);
  const isUpNext = useMemo(
    () =>
      typeof picksUntilCurrentUser === "number" &&
      picksUntilCurrentUser === 1,
    [picksUntilCurrentUser],
  );
  const draftActionPlayerName = selectedPlayer?.playerName ?? nextQueuedEligiblePlayerName ?? null;
  const hasPendingManualConfirm = Boolean(pendingManualDraftPlayerName);
  const serverTimeoutFallbackPlayer = useMemo(() => {
    if (!draft?.availablePlayers || userPicks.length >= 5) {
      return null;
    }
    let bestCandidate: DraftDetail["availablePlayers"][number] | null = null;
    for (const player of draft.availablePlayers) {
      const normalizedRole = normalizeRole(player.playerRole);
      if (normalizedRole === UNASSIGNED_ROLE || userRoleSet.has(normalizedRole)) {
        continue;
      }
      if (!bestCandidate || compareAutopickCandidates(player, bestCandidate) < 0) {
        bestCandidate = player;
      }
    }
    return bestCandidate;
  }, [draft?.availablePlayers, userPicks.length, userRoleSet]);
  const queueFirstFallbackPlayerName = useMemo(
    () => nextQueuedEligiblePlayerName ?? serverTimeoutFallbackPlayer?.playerName ?? null,
    [nextQueuedEligiblePlayerName, serverTimeoutFallbackPlayer?.playerName],
  );
  const queueFirstFallbackPlayer = useMemo(
    () =>
      queueFirstFallbackPlayerName
        ? availablePlayersByName.get(queueFirstFallbackPlayerName) ?? null
        : null,
    [availablePlayersByName, queueFirstFallbackPlayerName],
  );
  const autopickTargetLabel = useMemo(() => {
    if (!queueFirstFallbackPlayerName) {
      return "No eligible timeout fallback";
    }
    if (!queueFirstFallbackPlayer) {
      return queueFirstFallbackPlayerName;
    }
    return `${queueFirstFallbackPlayer.playerName} (${formatRoleLabel(queueFirstFallbackPlayer.playerRole)})`;
  }, [queueFirstFallbackPlayer, queueFirstFallbackPlayerName]);
  const serverTimeoutFallbackLabel = useMemo(() => {
    if (!serverTimeoutFallbackPlayer) {
      return "No eligible player";
    }
    return `${serverTimeoutFallbackPlayer.playerName} (${formatRoleLabel(serverTimeoutFallbackPlayer.playerRole)})`;
  }, [serverTimeoutFallbackPlayer]);
  const autopickCountdownSeconds = useMemo(() => {
    if (
      !canCurrentUserPick ||
      !settings.autoPickFromQueue ||
      !queueFirstFallbackPlayerName ||
      currentPickRemainingMs === null
    ) {
      return null;
    }
    const remainingSeconds = Math.ceil(currentPickRemainingMs / 1000);
    if (remainingSeconds > 16 || remainingSeconds < 0) {
      return null;
    }
    return remainingSeconds;
  }, [
    canCurrentUserPick,
    currentPickRemainingMs,
    queueFirstFallbackPlayerName,
    settings.autoPickFromQueue,
  ]);
  const queueAutopickWarningMessage = useMemo(() => {
    if (!settings.autoPickFromQueue) {
      return null;
    }
    if (pickQueue.length === 0) {
      return QUEUE_EMPTY_AUTOPICK_WARNING;
    }
    if (queuedPlayers.length === 0) {
      return QUEUE_UNAVAILABLE_AUTOPICK_WARNING;
    }
    if (queuedEligiblePlayers.length === 0) {
      return QUEUE_INELIGIBLE_AUTOPICK_WARNING;
    }
    return null;
  }, [
    pickQueue.length,
    queuedEligiblePlayers.length,
    queuedPlayers.length,
    settings.autoPickFromQueue,
  ]);
  const showQueueEmptyAutopickWarning = Boolean(queueAutopickWarningMessage);
  const pendingManualDraftPlayer = pendingManualDraftPlayerName
    ? availablePlayersByName.get(pendingManualDraftPlayerName) ?? null
    : null;
  const pendingManualSlotImpact = useMemo(() => {
    if (!pendingManualDraftPlayer) {
      return null;
    }
    const normalizedRole = normalizeRole(pendingManualDraftPlayer.playerRole);
    if (normalizedRole === UNASSIGNED_ROLE) {
      return {
        fills: "N/A",
        warning: "Missing role data. Server will reject this pick.",
      };
    }
    if (!userRoleSet.has(normalizedRole)) {
      return { fills: normalizedRole, warning: null as string | null };
    }
    return {
      fills: normalizedRole,
      warning: `${normalizedRole} already filled. Server will reject this pick.`,
    };
  }, [pendingManualDraftPlayer, userRoleSet]);
  const isLowTimerWarning =
    canCurrentUserPick &&
    currentPickRemainingMs !== null &&
    currentPickRemainingMs >= 0 &&
    currentPickRemainingMs <= 10000;
  const autopickPreviewLine = useMemo(() => {
    if (!canCurrentUserPick || !settings.autoPickFromQueue) {
      return null;
    }
    if (!queueFirstFallbackPlayerName) {
      return "Autopick unavailable: no eligible player for timeout fallback.";
    }
    const clientLine =
      autopickCountdownSeconds !== null
        ? `Autopick in ${autopickCountdownSeconds}s: ${autopickTargetLabel}`
        : `Autopick target: ${autopickTargetLabel}`;
    const serverLine =
      autopickTargetLabel === serverTimeoutFallbackLabel
        ? null
        : `Timeout fallback: ${serverTimeoutFallbackLabel}`;

    if (!serverLine) {
      return clientLine;
    }
    return `${clientLine} • ${serverLine}`;
  }, [
    autopickCountdownSeconds,
    autopickTargetLabel,
    canCurrentUserPick,
    queueFirstFallbackPlayerName,
    serverTimeoutFallbackLabel,
    settings.autoPickFromQueue,
  ]);

  useEffect(() => {
    if (!draft || !isQueueHydrated) {
      return;
    }
    if (draft.availablePlayers.length === 0) {
      return;
    }
    const availableNames = new Set((draft?.availablePlayers ?? []).map((player) => player.playerName));
    setPickQueue((prevQueue) => {
      const nextQueue = prevQueue.filter((playerName) => availableNames.has(playerName));
      return nextQueue.length === prevQueue.length ? prevQueue : nextQueue;
    });
  }, [draft, isQueueHydrated]);

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

  useEffect(() => {
    if (!selectedPlayerName) {
      return;
    }
    if (availablePlayersByName.has(selectedPlayerName)) {
      return;
    }
    const draftedPick =
      draft?.picks.findLast?.((pick) => pick.playerName === selectedPlayerName) ??
      [...(draft?.picks ?? [])].reverse().find((pick) => pick.playerName === selectedPlayerName) ??
      null;
    const unavailableMessage = draftedPick
      ? `Player no longer available: ${selectedPlayerName} was drafted by ${draftedPick.participantDisplayName}.`
      : `Player no longer available: ${selectedPlayerName}.`;
    setSelectionNotice(unavailableMessage);
    pushToast(unavailableMessage);
    pushSystemFeedEvent(`Selected player unavailable: ${unavailableMessage}`, draftedPick?.overallPick);
    trackDraftEvent("selection.unavailable", {
      playerName: selectedPlayerName,
      overallPick: draftedPick?.overallPick ?? null,
    });
    if (draftedPick?.overallPick) {
      jumpToTimelinePick(draftedPick.overallPick);
    }
    setSelectedPlayerName(null);
    if (pendingManualDraftPlayerName === selectedPlayerName) {
      setPendingManualDraftPlayerName(null);
    }
  }, [
    availablePlayersByName,
    draft?.picks,
    jumpToTimelinePick,
    pendingManualDraftPlayerName,
    pushSystemFeedEvent,
    pushToast,
    selectedPlayerName,
    trackDraftEvent,
  ]);

  useEffect(() => {
    if (!pendingManualDraftPlayerName) {
      return;
    }
    if (!canDraftActions || !availablePlayersByName.has(pendingManualDraftPlayerName)) {
      if (!availablePlayersByName.has(pendingManualDraftPlayerName)) {
        setSelectionNotice("Player no longer available.");
      }
      setPendingManualDraftPlayerName(null);
    }
  }, [availablePlayersByName, canDraftActions, pendingManualDraftPlayerName]);

  useEffect(() => {
    if (timelineHighlightPick === null) {
      return;
    }
    const id = window.setTimeout(() => {
      setTimelineHighlightPick(null);
    }, 4000);
    return () => {
      window.clearTimeout(id);
    };
  }, [timelineHighlightPick]);

  useEffect(() => {
    if (topStripHighlightPick === null) {
      return;
    }
    const id = window.setTimeout(() => {
      setTopStripHighlightPick(null);
    }, TOP_PICK_STRIP_HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(id);
    };
  }, [topStripHighlightPick]);

  useEffect(() => {
    if (!draft) {
      return;
    }
    const previous = previousDraftSnapshotRef.current;
    const nextSnapshot = {
      status: draft.status,
      pickCount: draft.pickCount,
      onClockUserId: draft.nextPick?.participantUserId ?? null,
      picksUntilTurn: picksUntilCurrentUser,
    };
    if (!previous) {
      previousDraftSnapshotRef.current = nextSnapshot;
      return;
    }

    if (previous.status !== nextSnapshot.status) {
      pushToast(`Draft status: ${nextSnapshot.status}`);
      pushSystemFeedEvent(`Status changed: ${nextSnapshot.status}.`);
    }

    if (previous.pickCount !== nextSnapshot.pickCount) {
      const latestPick = draft.picks[draft.picks.length - 1];
      if (latestPick) {
        setTopStripHighlightPick(latestPick.overallPick);
        pushToast(
          `Pick #${latestPick.overallPick}: ${latestPick.participantDisplayName} drafted ${latestPick.playerName}`,
        );
        pushSystemFeedEvent(
          `Pick #${latestPick.overallPick}: ${latestPick.participantDisplayName} drafted ${latestPick.playerName}.`,
          latestPick.overallPick,
        );
      }
    }

    if (previous.onClockUserId !== nextSnapshot.onClockUserId) {
      if (nextSnapshot.onClockUserId === currentUserId) {
        pushToast("You are on the clock.");
        playCue(700, 260);
        pushSystemFeedEvent("You are now on the clock.");
        if (settings.vibrateOnTurn && typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([80, 40, 120]);
        }
      } else if (
        typeof nextSnapshot.picksUntilTurn === "number" &&
        nextSnapshot.picksUntilTurn === 1
      ) {
        pushToast("Up next: your turn in 1 pick.");
        playCue(520, 180);
        pushSystemFeedEvent("Up next: your turn in 1 pick.");
        if (settings.vibrateOnTurn && typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate([55, 30, 55]);
        }
      }
    }

    previousDraftSnapshotRef.current = nextSnapshot;
  }, [
    currentUserId,
    draft,
    picksUntilCurrentUser,
    playCue,
    pushSystemFeedEvent,
    pushToast,
    settings.vibrateOnTurn,
  ]);

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
    const startedAt = performance.now();
    let responseStatus = 0;
    let serverTimingTotalMs: number | null = null;

    try {
      const response = await fetch(`/api/drafts/${draft.id}/status`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ status, force }),
      });
      responseStatus = response.status;
      serverTimingTotalMs = parseServerTimingTotalMs(response.headers.get("server-timing"));

      const payload = (await response.json()) as DraftDetailResponse;
      if (!response.ok || !payload.draft) {
        throw new Error(payload.error ?? "Unable to update draft status.");
      }
      applyDraft(payload.draft);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update status.");
    } finally {
      queueClientMetric("client_draft_status_latency_ms", performance.now() - startedAt, {
        statusCode: responseStatus,
        serverTotalMs: serverTimingTotalMs,
        draftId: draft.id,
        nextStatus: status,
      });
      setStatusPending(false);
      setStatusAction(null);
    }
  };

  const submitPick = useCallback(
    async (
      playerName: string | null = draftActionPlayerName,
      {
        source = "manual",
      }: {
        source?: "manual" | "autopick";
      } = {},
    ) => {
      if (!draft || !playerName || !canDraftActions) {
        return;
      }
      const expectedPick = draft.nextPick?.overallPick ?? null;
      setPickPending(true);
      setError(null);
      const startedAt = performance.now();
      let responseStatus = 0;
      let serverTimingTotalMs: number | null = null;

      try {
        const response = await fetch(`/api/drafts/${draft.id}/pick`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ playerName }),
        });
        responseStatus = response.status;
        serverTimingTotalMs = parseServerTimingTotalMs(response.headers.get("server-timing"));
        const payload = (await response.json()) as DraftDetailResponse;
        if (!response.ok || !payload.draft) {
          const message = payload.error ?? "Unable to submit pick.";
          const code = payload.code ?? null;
          setError(message);
          trackDraftEvent("draft.failed", { source, playerName, reason: message, code });
          setPendingManualDraftPlayerName(null);
          setSelectedPlayerName(null);

          const likelyClockRace =
            code === "PICK_DEADLINE_EXPIRED" ||
            code === "OUT_OF_TURN" ||
            code === "NOT_LIVE";
          const autopickTargetInvalid =
            source === "autopick" &&
            (code === "PLAYER_UNAVAILABLE" ||
              code === "POSITION_TAKEN" ||
              code === "PLAYER_ROLE_REQUIRED");
          const autopickShouldRetry =
            source === "autopick" &&
            !likelyClockRace &&
            code !== "ROSTER_FULL" &&
            code !== "DRAFT_COMPLETE";

          if (autopickTargetInvalid) {
            setPickQueue((prevQueue) => prevQueue.filter((queuedName) => queuedName !== playerName));
          }
          if (autopickShouldRetry) {
            autoPickAttemptedForPickRef.current = null;
          }

          if (likelyClockRace && expectedPick) {
            timeoutExpectedPickRef.current = expectedPick;
            setTimeoutOutcomeMessage("Clock expired -> Resolving server outcome...");
            setSelectionNotice("Clock expired before confirmation. Resolving server outcome...");
          } else if (autopickTargetInvalid) {
            setSelectionNotice(`Autopick skipped ${playerName}. Trying next queue option...`);
          } else if (source === "autopick" && autopickShouldRetry) {
            setSelectionNotice("Autopick attempt failed. Retrying...");
          } else {
            setSelectionNotice("Resolving pick outcome from server...");
          }

          void requestDraftRefresh()
            .then(() => {
              if (!likelyClockRace && !(source === "autopick" && autopickShouldRetry)) {
                setSelectionNotice("Pick outcome resolved by server.");
              }
            })
            .catch(() => undefined);
          return;
        }
        applyDraft(payload.draft);
        setPickQueue((prevQueue) => prevQueue.filter((queuedName) => queuedName !== playerName));
        setSelectedPlayerName(null);
        setPendingManualDraftPlayerName(null);
        setSelectionNotice("Pick locked.");
        trackDraftEvent("draft.confirmed", {
          source,
          playerName,
          overallPick: payload.draft.nextPick ? payload.draft.nextPick.overallPick - 1 : null,
        });
        if (source === "manual") {
          pushToast(`Pick submitted: ${playerName}`);
        }
      } catch (pickError) {
        const message = pickError instanceof Error ? pickError.message : "Unable to submit pick.";
        setError(message);
        trackDraftEvent("draft.failed", { source, playerName, reason: message });
        setPendingManualDraftPlayerName(null);
        setSelectedPlayerName(null);
        const likelyClockRaceFromTiming =
          expectedPick !== null &&
          currentPickRemainingMs !== null &&
          currentPickRemainingMs <= 1200;
        const autopickShouldRetry = source === "autopick" && !likelyClockRaceFromTiming;
        if (autopickShouldRetry) {
          autoPickAttemptedForPickRef.current = null;
        }
        if (likelyClockRaceFromTiming) {
          timeoutExpectedPickRef.current = expectedPick;
          setTimeoutOutcomeMessage("Clock expired -> Resolving server outcome...");
          setSelectionNotice("Clock expired before confirmation. Resolving server outcome...");
        } else if (autopickShouldRetry) {
          setSelectionNotice("Autopick attempt failed. Retrying...");
        } else {
          setSelectionNotice("Resolving pick outcome from server...");
        }
        void requestDraftRefresh()
          .then(() => {
            if (!expectedPick && source !== "autopick") {
              setSelectionNotice("Pick outcome resolved by server.");
            }
          })
          .catch(() => undefined);
      } finally {
        queueClientMetric("client_draft_pick_latency_ms", performance.now() - startedAt, {
          statusCode: responseStatus,
          serverTotalMs: serverTimingTotalMs,
          draftId: draft.id,
          source,
        });
        setPickPending(false);
      }
    },
    [
      applyDraft,
      canDraftActions,
      draft,
      draftActionPlayerName,
      currentPickRemainingMs,
      pushToast,
      queueClientMetric,
      requestDraftRefresh,
      trackDraftEvent,
    ],
  );

  const addPlayerToQueue = useCallback(
    (playerName: string) => {
      if (!canQueueActions) {
        return;
      }
      setPickQueue((prevQueue) => {
        if (prevQueue.includes(playerName)) {
          return prevQueue;
        }
        return [...prevQueue, playerName];
      });
    },
    [canQueueActions],
  );

  const removePlayerFromQueue = (playerName: string) => {
    if (!canQueueActions) {
      return;
    }
    setPickQueue((prevQueue) => prevQueue.filter((queuedName) => queuedName !== playerName));
  };

  const clearQueue = () => {
    if (!canQueueActions || pickQueue.length === 0) {
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Clear all players from your queue?")) {
      return;
    }
    setPickQueue([]);
  };

  const moveQueueItem = (fromIndex: number, toIndex: number) => {
    if (!canQueueActions) {
      return;
    }
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

  const handlePlayerTapOrClick = useCallback(
    (
      playerName: string,
      event?: { target: EventTarget | null },
    ) => {
      const target = event?.target;
      if (target instanceof HTMLElement && target.closest("button")) {
        return;
      }

      setSelectedPlayerName(playerName);
      setSelectionNotice(null);
      if (!isMobileViewport) {
        setIsPlayerDetailDrawerOpen(true);
      }

      const nowMs = Date.now();
      const previous = lastPlayerTapRef.current;
      if (
        previous &&
        previous.playerName === playerName &&
        nowMs - previous.atMs <= DOUBLE_TAP_WINDOW_MS
      ) {
        lastPlayerTapRef.current = null;
        if (queuedPlayerNameSet.has(playerName)) {
          return;
        }
        addPlayerToQueue(playerName);
        pushToast(`${playerName} added to queue.`);
        return;
      }

      lastPlayerTapRef.current = {
        playerName,
        atMs: nowMs,
      };
    },
    [addPlayerToQueue, isMobileViewport, pushToast, queuedPlayerNameSet],
  );

  const requestManualDraft = useCallback(
    (playerName: string | null = draftActionPlayerName) => {
      if (!playerName || !canDraftActions) {
        return;
      }
      if (settings.requirePickConfirm) {
        setPendingManualDraftPlayerName(playerName);
        return;
      }
      void submitPick(playerName, { source: "manual" });
    },
    [canDraftActions, draftActionPlayerName, settings.requirePickConfirm, submitPick],
  );

  const toggleAutopickSetting = useCallback(
    (source: string) => {
      if (isRealtimeReadOnly) {
        trackDraftEvent("autopick.toggle_blocked", {
          source,
          reason: "connection_not_subscribed",
          connectionStatus,
        });
        pushToast("Autopick setting is locked while reconnecting.");
        return;
      }
      setSettings((prev) => {
        const enabled = !prev.autoPickFromQueue;
        trackDraftEvent("autopick.toggle", { source, enabled });
        return {
          ...prev,
          autoPickFromQueue: enabled,
        };
      });
    },
    [connectionStatus, isRealtimeReadOnly, pushToast, trackDraftEvent],
  );

  useEffect(() => {
    if (isMobileViewport) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          Boolean(target.closest("[role='textbox']")));
      if (!isTypingTarget && event.key === "/") {
        event.preventDefault();
        const searchInput = document.getElementById("draft-player-search");
        if (searchInput instanceof HTMLInputElement) {
          searchInput.focus();
        }
        return;
      }
      if (isTypingTarget) {
        return;
      }
      if (
        (event.key === "q" || event.key === "Q") &&
        selectedPlayerName &&
        canQueueActions &&
        !queuedPlayerNameSet.has(selectedPlayerName)
      ) {
        event.preventDefault();
        addPlayerToQueue(selectedPlayerName);
        pushToast(`${selectedPlayerName} added to queue.`);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (displayAvailablePlayers.length === 0) {
          return;
        }
        const currentIndex = selectedPlayerName
          ? displayAvailablePlayers.findIndex((player) => player.playerName === selectedPlayerName)
          : -1;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + delta + displayAvailablePlayers.length) % displayAvailablePlayers.length;
        const nextPlayer = displayAvailablePlayers[nextIndex];
        if (nextPlayer) {
          setSelectedPlayerName(nextPlayer.playerName);
        }
        return;
      }
      if (event.key === "Enter" && selectedPlayerName) {
        event.preventDefault();
        setIsPlayerDetailDrawerOpen(true);
        return;
      }
      if ((event.key === "d" || event.key === "D") && selectedPlayerName) {
        event.preventDefault();
        requestManualDraft(selectedPlayerName);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    addPlayerToQueue,
    canQueueActions,
    isMobileViewport,
    pushToast,
    queuedPlayerNameSet,
    requestManualDraft,
    selectedPlayerName,
    displayAvailablePlayers,
  ]);

  useEffect(() => {
    if (!hasPendingManualConfirm || isMobileViewport) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setPendingManualDraftPlayerName(null);
        return;
      }
      if (event.key !== "Enter" || !pendingManualDraftPlayerName || !canDraftActions) {
        return;
      }
      event.preventDefault();
      void submitPick(pendingManualDraftPlayerName, { source: "manual" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canDraftActions, hasPendingManualConfirm, isMobileViewport, pendingManualDraftPlayerName, submitPick]);

  useEffect(() => {
    if (
      !draft ||
      !settings.autoPickFromQueue ||
      !canDraftActions ||
      draft.status !== "live" ||
      !draft.currentPickDeadlineAt
    ) {
      return;
    }

    const deadlineMs = new Date(draft.currentPickDeadlineAt).getTime();
    const pickNumber = draft.nextPick?.overallPick ?? null;
    if (!pickNumber) {
      return;
    }

    const id = window.setInterval(() => {
      if (pickPending) {
        return;
      }
      if (autoPickAttemptedForPickRef.current === pickNumber) {
        return;
      }

      const nowMs = Date.now() + serverOffsetMs;
      const remainingMs = deadlineMs - nowMs;
      if (remainingMs < 0) {
        return;
      }
      const queueTargetPlayerName = nextQueuedEligiblePlayerName;
      const useLowTimeFallback =
        !queueTargetPlayerName && remainingMs <= AUTOPICK_TRIGGER_MS;
      const targetPlayerName = queueTargetPlayerName ?? (useLowTimeFallback ? queueFirstFallbackPlayerName : null);
      if (!targetPlayerName) {
        return;
      }

      autoPickAttemptedForPickRef.current = pickNumber;
      pushToast(`Autopick queued: ${targetPlayerName}`);
      pushSystemFeedEvent(
        useLowTimeFallback
          ? `Autopick queued in low time: ${targetPlayerName}.`
          : `Autopick queued immediately: ${targetPlayerName}.`,
        pickNumber,
      );
      void submitPick(targetPlayerName, { source: "autopick" });
    }, 220);

    return () => {
      window.clearInterval(id);
    };
  }, [
    canDraftActions,
    draft,
    nextQueuedEligiblePlayerName,
    pickPending,
    queueFirstFallbackPlayerName,
    serverOffsetMs,
    settings.autoPickFromQueue,
    pushSystemFeedEvent,
    pushToast,
    submitPick,
  ]);

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

  const draftStatusValue = draft?.status ?? null;
  const isLobbyState = draftStatusValue === "scheduled";
  const isLiveState = draftStatusValue === "live" || draftStatusValue === "paused";
  const isResultsState = draftStatusValue === "completed";
  const roleWarningTargetPlayer =
    hasPendingManualConfirm && pendingManualDraftPlayer
      ? pendingManualDraftPlayer
      : selectedPlayer && (canCurrentUserPick || isSelectedPlayerQueued)
      ? selectedPlayer
      : queueFirstFallbackPlayer;
  const roleWarningTargetRole = roleWarningTargetPlayer
    ? normalizeRole(roleWarningTargetPlayer.playerRole)
    : UNASSIGNED_ROLE;
  const roleWarningShouldShow =
    roleWarningTargetRole !== UNASSIGNED_ROLE && userRoleSet.has(roleWarningTargetRole);
  const roleWarningContextLabel =
    hasPendingManualConfirm && pendingManualDraftPlayer
      ? "Confirming pick"
      : selectedPlayer && (canCurrentUserPick || isSelectedPlayerQueued)
      ? "Selected player"
      : "Queue target";
  const selectedPlayerInsights = useMemo(() => {
    if (!selectedPlayer) {
      return null;
    }
    const analytics = selectedPlayer.analytics ?? null;
    const normalizedRole = normalizeRole(selectedPlayer.playerRole);
    const roleRemainingCount = roleCounts.get(normalizedRole) ?? 0;
    const recentPicks = (draft?.picks ?? []).slice(-10);
    const recentRolePickCount = recentPicks.filter(
      (pick) => normalizeRole(pick.playerRole) === normalizedRole,
    ).length;
    const recentTeamPickCount = recentPicks.filter(
      (pick) =>
        selectedPlayer.playerTeam &&
        pick.playerTeam &&
        pick.playerTeam.toUpperCase() === selectedPlayer.playerTeam.toUpperCase(),
    ).length;
    const queueIndex = pickQueue.findIndex((name) => name === selectedPlayer.playerName);
    const reasons: string[] = [];
    const isCoreNeed =
      PRIMARY_ROLE_FILTERS.includes(normalizedRole as (typeof PRIMARY_ROLE_FILTERS)[number]) &&
      rosterNeeds.includes(normalizedRole as (typeof PRIMARY_ROLE_FILTERS)[number]);
    if (isCoreNeed) {
      reasons.push("Fills one of your open core roster slots.");
    }
    if (analytics?.overallRank) {
      reasons.push(`Ranks #${analytics.overallRank} in this draft pool by per-game output.`);
    }
    if (analytics?.positionRank) {
      reasons.push(
        `Ranks #${analytics.positionRank} at ${formatRoleLabel(selectedPlayer.playerRole)} in this draft pool.`,
      );
    }
    if (roleRemainingCount > 0 && roleRemainingCount <= ROLE_SCARCITY_THRESHOLD) {
      reasons.push(
        `${formatRoleLabel(selectedPlayer.playerRole)} is scarce with ${roleRemainingCount} left in the pool.`,
      );
    }
    if (recentTeamPickCount >= 2) {
      reasons.push(`${selectedPlayer.playerTeam ?? "This team"} players are being drafted quickly.`);
    }
    if (reasons.length === 0) {
      reasons.push("Stable best-available option based on current board flow.");
    }
    return {
      roleRemainingCount,
      recentRolePickCount,
      recentTeamPickCount,
      queueIndex,
      reasons: reasons.slice(0, 3),
      analytics,
    };
  }, [draft?.picks, pickQueue, roleCounts, rosterNeeds, selectedPlayer]);
  const stateBanner = useMemo<StateBanner>(() => {
    const isRealtimeDisconnected =
      connectionStatus === "TIMED_OUT" ||
      connectionStatus === "CHANNEL_ERROR" ||
      connectionStatus === "CLOSED";
    const isRedConnectionState = isRealtimeDisconnected && isRealtimeReadOnly;
    const isYellowConnectionState = !isRedConnectionState && connectionStatus !== "SUBSCRIBED";
    if (timeoutOutcomeMessage?.startsWith("Clock expired ->")) {
      return {
        label: "Resolving timeout outcome...",
        detail: timeoutOutcomeMessage,
        color: "warning" as const,
        icon: ShieldAlert,
        iconClassName: "text-warning-300",
      };
    }
    if (isRedConnectionState) {
      return {
        label: "Reconnecting (Read-only)",
        detail: `Last synced ${secondsSinceLastSync}s ago.`,
        color: "danger" as const,
        icon: WifiOff,
        iconClassName: "text-danger-300",
        iconOnly: true,
      };
    }
    if (isYellowConnectionState) {
      if (connectionStatus === "connecting") {
        return {
          label: "Connecting realtime...",
          detail: `Last synced ${secondsSinceLastSync}s ago.`,
          color: "default" as const,
          icon: Wifi,
          iconClassName: "text-default-300",
          iconOnly: true,
        };
      }
      return {
        label: "Live (polling fallback)",
        detail: `Realtime ${connectionLabel}. Last synced ${secondsSinceLastSync}s ago.`,
        color: "default" as const,
        icon: Wifi,
        iconClassName: "text-warning-300",
        iconOnly: true,
      };
    }
    if (pickPending) {
      return {
        label: "Submitting pick...",
        detail: "Waiting for server confirmation.",
        color: "warning" as const,
        icon: Gauge,
        iconClassName: "text-warning-300",
      };
    }
    if (draftStatusValue === "completed") {
      return {
        label: "Draft complete",
        detail: "Board is locked.",
        color: "secondary" as const,
        icon: SquareCheckBig,
        iconClassName: "text-default-200",
      };
    }
    if (draftStatusValue === "paused") {
      return {
        label: "Paused by commissioner",
        detail: "Waiting for resume.",
        color: "warning" as const,
        icon: Pause,
        iconClassName: "text-warning-300",
      };
    }
    if (canCurrentUserPick) {
      return {
        label: "Live",
        detail: autopickPreviewLine ?? "Select and confirm your pick.",
        color: "success" as const,
        icon: Wifi,
        iconClassName: "text-success-300",
        iconOnly: true,
      };
    }
    if (isUpNext) {
      return {
        label: "Live",
        detail: "You're up next (1 pick away).",
        color: "primary" as const,
        icon: UserCheck,
        iconClassName: "text-primary-300",
      };
    }
    if (isLiveState) {
      return {
        label: "Live",
        detail: "All systems normal.",
        color: "success" as const,
        icon: Wifi,
        iconClassName: "text-success-300",
        iconOnly: true,
      };
    }
    if (isLobbyState) {
      return {
        label: "Waiting room",
        detail: "Ready check in progress.",
        color: "default" as const,
        icon: UserCheck,
        iconClassName: "text-default-300",
      };
    }
    return {
      label: "Draft state",
      detail: "Awaiting updates.",
      color: "default" as const,
      icon: Gauge,
      iconClassName: "text-default-300",
    };
  }, [
    autopickPreviewLine,
    canCurrentUserPick,
    connectionLabel,
    connectionStatus,
    draftStatusValue,
    isLiveState,
    isLobbyState,
    isRealtimeReadOnly,
    isUpNext,
    pickPending,
    secondsSinceLastSync,
    timeoutOutcomeMessage,
  ]);
  const statusBannerToneClass = useMemo(() => {
    if (stateBanner.color === "danger") {
      return "border-danger-300/35 bg-danger-500/8";
    }
    if (stateBanner.color === "warning") {
      return "border-warning-300/35 bg-warning-500/8";
    }
    if (stateBanner.color === "secondary") {
      return "border-default-300/45 bg-default-500/8";
    }
    if (stateBanner.color === "success") {
      return "border-success-300/35 bg-success-500/8";
    }
    if (stateBanner.color === "primary") {
      return "border-primary-300/35 bg-primary-500/8";
    }
    return "border-default-200/45 bg-content2/30";
  }, [stateBanner.color]);
  const StateBannerIcon = stateBanner.icon;
  const isConnectedIndicator =
    stateBanner.iconOnly &&
    stateBanner.color === "success" &&
    stateBanner.icon === Wifi &&
    connectionStatus === "SUBSCRIBED" &&
    !isRealtimeReadOnly;
  const showReadOnlyInteractionOverlay = isLiveState && isRealtimeReadOnly;
  const queueAutopickTargetLine =
    settings.autoPickFromQueue && queuedEligiblePlayers.length > 0
      ? `Autopick will take #1: ${queuedEligiblePlayers[0].playerName}`
      : null;

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

  const currentYear = new Date().getFullYear();
  const footerUpdatedLabel = new Date(draft.serverNow).toLocaleString();
  const footerSourceLink = sourceLinkForPage(draft.sourcePage);

  return (
    <section
      className={`space-y-5 pb-24 md:pb-6 ${
        isMobileViewport &&
        isLiveState &&
        isCurrentUserParticipant &&
        !selectedPlayer &&
        !isMobileQueueSheetOpen
          ? "pb-[9.5rem]"
          : ""
      } ${
        canCurrentUserPick
          ? "rounded-large border border-primary-300/30 bg-primary-500/[0.04] p-2 shadow-[0_0_0_1px_rgba(147,197,253,0.2)]"
          : ""
      }`}
    >
      <div className="pointer-events-none fixed bottom-3 right-3 z-50 flex w-[min(22rem,calc(100vw-1.5rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {toastNotices.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 18, y: 6, scale: 0.98 }}
              initial={{ opacity: 0, x: 24, y: 10, scale: 0.98 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <Alert
                color={toastColorForMessage(toast.message)}
                description={toast.message}
                isClosable
                radius="md"
                variant="faded"
                className="pointer-events-auto w-full bg-content1/95 text-xs shadow-lg backdrop-blur"
                classNames={{
                  description: "text-xs",
                }}
                onClose={() => dismissToast(toast.id)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div
        className={`relative sticky top-2 z-30 rounded-large p-px ${
          canCurrentUserPick ? "shadow-[0_0_0_1px_rgba(147,197,253,0.4),0_0_22px_rgba(59,130,246,0.22)]" : ""
        }`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] overflow-hidden rounded-[inherit] opacity-65 blur-[8px]"
        >
          <div
            className="absolute inset-[-160%] motion-reduce:animate-none animate-spin [animation-duration:7s]"
            style={{ backgroundImage: TOP_SECTION_BORDER_GRADIENT }}
          />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-[inherit]"
        >
          <div
            className="absolute inset-[-160%] motion-reduce:animate-none animate-spin [animation-duration:7s]"
            style={{ backgroundImage: TOP_SECTION_BORDER_GRADIENT }}
          />
        </div>
        <Card
          className="relative z-10 overflow-hidden rounded-[inherit] border border-transparent bg-gradient-to-br from-content1 via-content1 to-content2 shadow-md"
        >
        <Image
          alt=""
          aria-hidden
          className="pointer-events-none z-0 object-cover opacity-[0.03]"
          fill
          quality={100}
          sizes="100vw"
          src={MAIN_TOP_BG_IMAGE_SRC}
          unoptimized
        />
        {isMobileViewport ? (
          <div className="absolute right-2 top-2 z-20 flex items-center gap-2 rounded-large border border-default-200/40 bg-content1/92 p-1.5 shadow-sm backdrop-blur">
            <Tooltip content={showStatusDetails ? "Hide status details" : "Show status details"} showArrow>
              <Button
                isIconOnly
                aria-label={showStatusDetails ? "Hide status details" : "Show status details"}
                size="sm"
                variant="flat"
                onPress={() => setShowStatusDetails((prev) => !prev)}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content={showDraftSettings ? "Hide draft settings" : "Show draft settings"} showArrow>
              <Button
                isIconOnly
                aria-label={showDraftSettings ? "Hide draft settings" : "Show draft settings"}
                size="sm"
                variant="flat"
                onPress={() => setShowDraftSettings((prev) => !prev)}
              >
                <Cog className="h-4 w-4" />
              </Button>
            </Tooltip>
            {draft.isCommissioner ? (
              <Tooltip content="Open commissioner controls" showArrow>
                <Button
                  isIconOnly
                  aria-label="Open commissioner controls"
                  color="warning"
                  size="sm"
                  variant="flat"
                  onPress={() => setIsCommissionerDrawerOpen(true)}
                >
                  <Shield className="h-4 w-4" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
        <CardHeader className="relative z-10 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold md:text-2xl">{draft.name}</h1>
              {draft.status !== "live" ? (
                <Chip color={statusColor(draft.status)} size="sm" variant="flat">
                  {draft.status}
                </Chip>
              ) : null}
            </div>
            <p className="text-xs text-default-500">
              {draft.leagueSlug} {draft.seasonYear} • {draft.pickSeconds}s timer • {draft.roundCount} rounds
            </p>
            <div className="flex items-center gap-1.5 text-xs text-default-500">
              <span>Format: Reverse snake (3RR)</span>
              <Popover
                isOpen={isFormatPopoverOpen}
                placement="bottom-start"
                showArrow
                onOpenChange={setIsFormatPopoverOpen}
              >
                <PopoverTrigger>
                  <button
                    aria-label="Explain reverse snake (3RR)"
                    className="inline-flex h-5 w-5 items-center justify-center rounded-full text-default-400 transition hover:bg-content2/40 hover:text-default-200"
                    type="button"
                    onBlur={() => setIsFormatPopoverOpen(false)}
                    onFocus={() => setIsFormatPopoverOpen(true)}
                    onMouseEnter={() => setIsFormatPopoverOpen(true)}
                    onMouseLeave={() => setIsFormatPopoverOpen(false)}
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="max-w-xs p-3 text-xs text-default-600"
                  onMouseEnter={() => setIsFormatPopoverOpen(true)}
                  onMouseLeave={() => setIsFormatPopoverOpen(false)}
                >
                  <div className="space-y-1.5">
                    <p className="font-semibold text-default-800">Reverse snake (3RR)</p>
                    <p>Round 1: 1 to N</p>
                    <p>Round 2: N to 1</p>
                    <p>Round 3: N to 1 (reversal round)</p>
                    <p>Round 4+: alternate direction each round.</p>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-[11px] text-default-500">
              {draft.status === "live"
                ? draft.nextPick
                  ? `Live • Pick #${draft.nextPick.overallPick} • R${draft.nextPick.roundNumber}`
                  : "Live"
                : draft.status === "paused"
                ? "Paused"
                : draft.status === "completed"
                ? "Completed"
                : "Scheduled"}
            </p>
          </div>

          <div className="w-full self-start pt-0.5 md:w-auto md:justify-self-end">
            <div className="flex items-center justify-end gap-2">
              {stateBanner.iconOnly ? (
                <Tooltip content={stateBanner.label} showArrow>
                  <div
                    className={
                      isConnectedIndicator
                        ? "inline-flex h-9 w-9 items-center justify-center"
                        : `grid h-9 w-9 place-items-center rounded-large border ${statusBannerToneClass}`
                    }
                  >
                    <StateBannerIcon
                      className={
                        isConnectedIndicator
                          ? "h-4 w-4 text-emerald-300 animate-pulse [animation-duration:1.7s] drop-shadow-[0_0_8px_rgba(74,222,128,0.65)]"
                          : `h-4 w-4 ${stateBanner.iconClassName}`
                      }
                    />
                  </div>
                </Tooltip>
              ) : (
                <div
                  className={`flex items-center gap-2 rounded-large border px-3 py-2 text-xs ${statusBannerToneClass}`}
                >
                  <StateBannerIcon className={`h-4 w-4 ${stateBanner.iconClassName}`} />
                  <p className="font-semibold">{stateBanner.label}</p>
                </div>
              )}
              {!isMobileViewport ? (
                <>
                  <Tooltip content={showStatusDetails ? "Hide status details" : "Show status details"} showArrow>
                    <Button
                      isIconOnly
                      aria-label={showStatusDetails ? "Hide status details" : "Show status details"}
                      size="sm"
                      variant="flat"
                      onPress={() => setShowStatusDetails((prev) => !prev)}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                  <Tooltip content={settings.muted ? "Unmute draft sounds" : "Mute draft sounds"} showArrow>
                    <Button
                      isIconOnly
                      aria-label={settings.muted ? "Unmute draft sounds" : "Mute draft sounds"}
                      size="sm"
                      variant="flat"
                      onPress={() =>
                        setSettings((prev) => ({
                          ...prev,
                          muted: !prev.muted,
                        }))
                      }
                    >
                      {settings.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                    </Button>
                  </Tooltip>
                  <Tooltip content={showDraftSettings ? "Hide draft settings" : "Show draft settings"} showArrow>
                    <Button
                      isIconOnly
                      aria-label={showDraftSettings ? "Hide draft settings" : "Show draft settings"}
                      size="sm"
                      variant="flat"
                      onPress={() => setShowDraftSettings((prev) => !prev)}
                    >
                      <Cog className="h-4 w-4" />
                    </Button>
                  </Tooltip>
                  {draft.isCommissioner ? (
                    <Tooltip content="Open commissioner controls" showArrow>
                      <Button
                        isIconOnly
                        aria-label="Open commissioner controls"
                        color="warning"
                        size="sm"
                        variant="flat"
                        onPress={() => setIsCommissionerDrawerOpen(true)}
                      >
                        <Shield className="h-4 w-4" />
                      </Button>
                    </Tooltip>
                  ) : null}
                </>
              ) : null}
            </div>
            {showStatusDetails ? (
              <div className="rounded-large border border-default-200/35 bg-content2/35 px-3 py-2 text-xs">
                <p className="font-medium">{stateBanner.detail}</p>
                <p className="mt-1 text-default-500">Connection: {connectionLabel}</p>
                {queueAutopickTargetLine ? <p className="mt-1 text-default-500">{queueAutopickTargetLine}</p> : null}
                {autopickCountdownSeconds !== null ? (
                  <p className="mt-1 text-warning-300">
                    {`Autopick in ${autopickCountdownSeconds}s: ${autopickTargetLabel}`}
                  </p>
                ) : null}
                {showQueueEmptyAutopickWarning ? (
                  <p className="mt-1 text-warning-300">
                    {queueAutopickWarningMessage}
                  </p>
                ) : null}
                {isRealtimeReadOnly ? (
                  <p className="mt-1 text-warning-300">
                    Realtime reconnecting. Read-only mode. Last synced {secondsSinceLastSync}s ago.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardBody className="relative z-10 space-y-3 pt-0">
          <div className="overflow-x-clip">
            <ScrollShadow
              className="overflow-y-visible pt-1 pb-1 [overscroll-behavior-x:contain] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden md:overflow-visible md:pt-0 md:pb-0"
              orientation="horizontal"
            >
              <motion.div layout className="flex w-max items-end gap-1.5 md:w-full md:gap-2">
              <AnimatePresence initial={false}>
                {topPickStripSlots.map((item) => {
                  const isNowTile = item.offset === 0;
                  const isPastTile = item.offset < 0;
                  const isRecentlyLockedPick =
                    item.slot?.overallPick === topStripHighlightPick && Boolean(item.slot?.pickedPlayerName);
                  const showNowClock =
                    isNowTile &&
                    draft.status === "live" &&
                    !item.slot?.pickedPlayerName &&
                    Boolean(draft.currentPickDeadlineAt);
                  const mobileStripLabel = isNowTile
                    ? "NOW"
                    : isPastTile
                    ? `${Math.abs(item.offset)} ${Math.abs(item.offset) === 1 ? "PICK" : "PICKS"} AGO`
                    : item.offset === 1
                    ? "NEXT PICK"
                    : `IN ${item.offset} PICKS`;
                  const roleBackgroundIconUrl = item.slot?.pickedPlayerRole
                    ? roleIconUrl(item.slot.pickedPlayerRole)
                    : null;
                  const onClockParticipantAvatarUrl =
                    isNowTile && !item.slot?.pickedPlayerName ? item.slot?.participantAvatarUrl ?? null : null;
                  const onClockTeamLabel =
                    item.slot?.participantTeamName?.trim() || item.slot?.participantDisplayName || "Pending";
                  const onClockParticipantShortLabel = formatShortPlayerName(
                    item.slot?.participantDisplayName,
                  );
                  const onClockPickMetaLabel =
                    item.slot
                      ? `Pick ${item.slot.overallPick} • Rd ${item.slot.roundNumber}`
                      : "Pick -- • Rd --";
                  const rightPortraitImageUrl =
                    item.slot?.pickedPlayerImageUrl ?? (showNowClock ? null : onClockParticipantAvatarUrl);
                  const teamLabel = item.slot?.participantDisplayName ?? "Pending";
                  const shortPlayerLabel = item.slot?.pickedPlayerName
                    ? formatShortPlayerName(item.slot.pickedPlayerName)
                    : item.offset === 0
                    ? "On the clock"
                    : item.offset < 0
                    ? "Pending"
                    : "Upcoming";
                  return (
                    <motion.div
                      key={item.key}
                      layout
                      animate={
                        prefersReducedMotion
                          ? { opacity: 1, filter: "brightness(1)" }
                          : isRecentlyLockedPick
                          ? { opacity: 1, filter: ["brightness(1)", "brightness(1.08)", "brightness(1)"] }
                          : { opacity: 1, filter: "brightness(1)" }
                      }
                      exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98, filter: "brightness(1)" }}
                      initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98, filter: "brightness(1)" }}
                      transition={
                        prefersReducedMotion
                          ? { duration: 0.01 }
                          : {
                              duration: TOP_PICK_STRIP_FADE_DURATION,
                              ease: [0.22, 1, 0.36, 1],
                              layout: { duration: TOP_PICK_STRIP_LAYOUT_DURATION, ease: [0.22, 1, 0.36, 1] },
                            }
                      }
                      className={`relative shrink-0 rounded-large border will-change-transform ${
                        isNowTile ? "overflow-visible" : "overflow-hidden"
                      } ${
                        isNowTile
                          ? "h-[6.6rem] w-[7.35rem] p-2.5 md:h-[6.8rem] md:min-w-0 md:flex-[1.25] md:p-3"
                          : "h-[4.9rem] w-[3rem] p-1.5 md:h-[5rem] md:min-w-0 md:flex-[0.5] md:p-2"
                      } ${
                        item.slot?.pickedPlayerName
                          ? roleTileClassName(item.slot.pickedPlayerRole)
                          : isNowTile
                          ? item.slot
                            ? "border-primary-300/70 bg-primary-500/14 shadow-[0_0_0_1px_rgba(147,197,253,0.35)]"
                            : "border-default-200/35 bg-content2/24"
                          : isPastTile
                          ? "border-default-200/30 bg-content2/18"
                          : "border-default-200/25 bg-content2/14"
                      } ${
                        isNowTile
                          ? "ring-1 ring-primary-300/75 shadow-[0_0_0_1px_rgba(147,197,253,0.4),0_0_18px_rgba(59,130,246,0.24)]"
                          : ""
                      } ${
                        isRecentlyLockedPick
                          ? "shadow-[0_0_0_1px_rgba(110,231,183,0.45),0_0_20px_rgba(16,185,129,0.28)]"
                          : ""
                      }`}
                    >
                      {isNowTile ? (
                        <p className="pointer-events-none absolute -top-2.5 left-1/2 z-40 min-w-[7rem] -translate-x-1/2 whitespace-nowrap rounded-full border border-primary-200/65 bg-content1/96 px-3 py-1 text-center text-[10px] font-black uppercase tracking-[0.1em] text-white md:min-w-[7.5rem] md:text-[11px]">
                          On the clock
                        </p>
                      ) : null}
                      {isNowTile ? (
                        <p
                          className="pointer-events-none absolute left-2 top-2 z-35 max-w-[4.75rem] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-semibold tracking-[0.04em] text-white/92 drop-shadow-[0_1px_1px_rgba(0,0,0,0.75)]"
                        >
                          {onClockParticipantShortLabel}
                        </p>
                      ) : null}
                      {isNowTile ? (
                        <p className="pointer-events-none absolute -bottom-3 left-1/2 z-40 max-w-[7rem] -translate-x-1/2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-primary-200/65 bg-content1/96 px-3 py-1 text-center text-[10px] font-black uppercase tracking-[0.1em] text-white md:max-w-[7.5rem] md:text-[11px]">
                          {onClockTeamLabel}
                        </p>
                      ) : null}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/28 via-black/16 to-black/30" />
                      {isNowTile ? (
                        <p className="pointer-events-none absolute bottom-3 left-2 z-35 text-[10px] font-semibold text-white/92 drop-shadow-[0_1px_1px_rgba(0,0,0,0.75)]">
                          {onClockPickMetaLabel}
                        </p>
                      ) : null}
                      {showNowClock ? (
                        <>
                          <div className="pointer-events-none absolute inset-x-2 top-1/2 z-30 -translate-y-1/2">
                            <div className="flex items-center justify-center">
                              <DraftClockBadge
                                deadlineIso={draft.currentPickDeadlineAt}
                                draftStatus={draft.status}
                                pickSeconds={draft.pickSeconds}
                                serverOffsetMs={serverOffsetMs}
                                centerFallbackLabel={initialsForLabel(onClockTeamLabel)}
                                centerImageAlt={`${item.slot?.participantDisplayName ?? "On clock"} avatar`}
                                centerImageUrl={onClockParticipantAvatarUrl}
                                preferCenterFallbackLabel
                              />
                            </div>
                          </div>
                          <p className="pointer-events-none absolute bottom-3 right-2 z-35 mono-points text-lg font-black leading-none tabular-nums text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.75)] md:text-xl">
                            {liveTimeLeftLabel}
                          </p>
                        </>
                      ) : null}
                      {item.slot && (rightPortraitImageUrl || item.slot.pickedTeamIconUrl || roleBackgroundIconUrl) ? (
                        <div className="pointer-events-none absolute inset-y-1.5 right-1.5 z-20 flex flex-col items-end justify-between">
                          {rightPortraitImageUrl ? (
                            <Image
                              alt={
                                item.slot.pickedPlayerName
                                  ? `${item.slot.pickedPlayerName} portrait`
                                  : `${item.slot.participantDisplayName} avatar`
                              }
                              className={`rounded-full border border-white/35 object-cover shadow-[0_2px_8px_rgba(0,0,0,0.45)] ${
                                isNowTile ? "h-9 w-9 md:h-10 md:w-10" : "h-7 w-7 md:h-8 md:w-8"
                              }`}
                              height={40}
                              src={rightPortraitImageUrl}
                              width={40}
                            />
                          ) : item.slot.pickedTeamIconUrl ? (
                            <Image
                              alt={`${item.slot.pickedPlayerName ?? "Picked player"} team logo`}
                              className={`translate-x-1.5 -translate-y-1 object-contain opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)] ${
                                isNowTile ? "h-7 w-11 md:h-8 md:w-12" : "h-6 w-9 md:h-7 md:w-10"
                              }`}
                              height={32}
                              src={item.slot.pickedTeamIconUrl}
                              width={48}
                            />
                          ) : (
                            <span className="h-8 w-8" />
                          )}
                          {roleBackgroundIconUrl ? (
                            <Image
                              alt={`${formatRoleLabel(item.slot.pickedPlayerRole)} role icon`}
                              className={`-translate-x-1.5 object-contain opacity-95 drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)] ${
                                isNowTile ? "h-5 w-5 md:h-6 md:w-6" : "h-4 w-4 md:h-5 md:w-5"
                              }`}
                              height={24}
                              src={roleBackgroundIconUrl}
                              width={24}
                            />
                          ) : null}
                        </div>
                      ) : null}
                      {showNowClock ? null : (
                        <div className="relative z-10">
                          {!isNowTile ? (
                            <p
                              className={`truncate whitespace-nowrap text-[8px] font-semibold uppercase tracking-wide drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)] ${
                                isNowTile ? "text-white/72" : "text-white/55"
                              }`}
                            >
                              <span className="md:hidden">{mobileStripLabel}</span>
                              <span className="hidden md:inline">{item.label}</span>
                            </p>
                          ) : null}
                          {!isNowTile ? (
                            <p className="mt-0.5 truncate font-semibold text-[11px] text-white/92 drop-shadow-[0_1px_1px_rgba(0,0,0,0.7)] md:text-xs">
                              {teamLabel}
                            </p>
                          ) : null}
                          {!isNowTile ? (
                            <p
                              className={`mt-0.5 truncate text-[10px] drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)] ${
                                item.slot?.pickedPlayerName ? "text-white/86" : "text-white/62"
                              }`}
                            >
                              {shortPlayerLabel}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              </motion.div>
            </ScrollShadow>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1.55fr)]">
            <div
              className={`rounded-large border p-3.5 ${
                canCurrentUserPick
                  ? "border-primary-300/35 bg-gradient-to-br from-primary-500/10 via-content2/40 to-content2/30"
                  : "border-default-200/25 bg-content2/20"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-default-500">
                  {canCurrentUserPick ? "On the clock" : "Your next pick"}
                </p>
                {isRealtimeReadOnly && isLiveState ? (
                  <span className="inline-flex items-center gap-1 rounded-medium border border-warning-300/40 bg-warning-500/10 px-2 py-1 text-[10px] font-semibold text-warning-100">
                    <WifiOff className="h-3 w-3" />
                    Read-only
                  </span>
                ) : null}
              </div>
              {canCurrentUserPick && draft.nextPick ? (
                <div className="mt-2 mx-auto grid w-fit grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                  <div className="grid h-28 w-28 place-items-center rounded-large border border-white/25 bg-black/62 shadow-[0_8px_22px_rgba(0,0,0,0.35)]">
                    <p className="text-3xl font-black leading-none text-white tabular-nums sm:text-4xl">
                      {liveTimeLeftLabel}
                    </p>
                  </div>
                  <div className="min-w-0 space-y-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-default-400">
                        On the clock
                      </p>
                      <p className="mt-1 text-sm font-semibold">
                        #{draft.nextPick.overallPick} • Round {draft.nextPick.roundNumber}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-default-500">
                        Position needs
                      </p>
                      {rosterNeeds.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {rosterNeeds.map((role) => (
                            <Button
                              key={`next-pick-need-${role}`}
                              className={`h-6 min-w-0 px-2 ${roleChipClassName(role)}`}
                              size="sm"
                              variant="flat"
                              onPress={() => {
                                applyRoleFilter(role);
                                setShowNeededRolesOnly(true);
                              }}
                            >
                              {role}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-default-500">All core slots filled.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : yourNextPickMeta ? (
                <>
                  <p className="mt-2 text-sm font-semibold">
                    #{yourNextPickMeta.overallPick} • Round {yourNextPickMeta.roundNumber}
                  </p>
                  <p className="text-xs text-default-500">
                    {yourNextPickMeta.picksAway === 0
                      ? "On the clock now"
                      : `${yourNextPickMeta.picksAway} pick(s) away`}
                  </p>
                  <p className="mt-1 text-xs text-default-500">
                    Estimated time: ~{formatEtaFromMs(yourNextPickMeta.etaMs)}
                  </p>
                  <div className="mt-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-default-500">
                      Position needs
                    </p>
                    {rosterNeeds.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {rosterNeeds.map((role) => (
                          <Button
                            key={`next-pick-need-${role}`}
                            className={`h-6 min-w-0 px-2 ${roleChipClassName(role)}`}
                            size="sm"
                            variant="flat"
                            onPress={() => {
                              applyRoleFilter(role);
                              setShowNeededRolesOnly(true);
                            }}
                          >
                            {role}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-default-500">All core slots filled.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-default-500">No upcoming turn</p>
              )}
            </div>
            <div className="rounded-large border border-default-200/35 bg-content2/30 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-default-500">
                  Roster slots
                </p>
                <Chip className="font-semibold" size="sm" variant="flat">
                  {userPicks.length}/5
                </Chip>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-5 sm:gap-2">
                {PRIMARY_ROLE_FILTERS.map((role) => {
                  const pick = rosterSlots.byRole.get(role);
                  const pickImageUrl = pickPlayerImageUrl(pick);
                  const slotRoleIconUrl = roleIconUrl(role);
                  return (
                    <button
                      key={`roster-slot-${role}`}
                      className={`h-24 overflow-hidden rounded-large border text-left transition ${
                        pick
                          ? `border-default-200/50 bg-content1/45 ${roleTileClassName(role)}`
                          : "border-default-200/25 bg-content1/18"
                      }`}
                      type="button"
                      onClick={() => {
                        applyRoleFilter(role);
                        setShowNeededRolesOnly(true);
                      }}
                    >
                      {pick ? (
                        <div className="grid h-full grid-cols-2">
                          <div className="flex min-w-0 flex-col justify-between p-2">
                            {slotRoleIconUrl ? (
                              <Image
                                alt={`${role} role icon`}
                                className="h-3.5 w-3.5 object-contain opacity-90"
                                height={14}
                                src={slotRoleIconUrl}
                                width={14}
                              />
                            ) : (
                              <p className="text-[9px] font-semibold uppercase tracking-wide text-default-500">
                                {role}
                              </p>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold">{pick.playerName}</p>
                              <p className="truncate text-[10px] text-default-500">
                                {pick.playerTeam ?? "Unknown team"}
                              </p>
                            </div>
                          </div>
                          <div className="relative border-l border-default-200/25 bg-content1/20">
                            {pickImageUrl ? (
                              <Image
                                alt={`${pick.playerName} portrait`}
                                className="h-full w-full object-cover"
                                height={160}
                                src={pickImageUrl}
                                width={160}
                              />
                            ) : pick.teamIconUrl ? (
                              <div className="grid h-full place-items-center">
                                <CroppedTeamLogo
                                  alt={`${pick.playerName} team logo`}
                                  frameClassName="h-12 w-14"
                                  height={48}
                                  imageClassName="h-12"
                                  src={pick.teamIconUrl}
                                  width={56}
                                />
                              </div>
                            ) : (
                              <div className="grid h-full place-items-center">
                                <span className="h-8 w-8 rounded-full border border-default-300/40 bg-content2/40" />
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="relative grid h-full place-items-center p-2">
                          <div className="absolute left-2 top-2">
                            {slotRoleIconUrl ? (
                              <Image
                                alt={`${role} role icon`}
                                className="h-3.5 w-3.5 object-contain opacity-70"
                                height={14}
                                src={slotRoleIconUrl}
                                width={14}
                              />
                            ) : (
                              <p className="text-[9px] font-semibold uppercase tracking-wide text-default-500">
                                {role}
                              </p>
                            )}
                          </div>
                          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-default-400/85">
                            Pick Pending
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              {rosterSlots.overflow.length > 0 ? (
                <p className="mt-2 text-xs text-default-500">
                  Bench: {rosterSlots.overflow.map((pick) => pick.playerName).join(", ")}
                </p>
              ) : null}
            </div>
          </div>
          {isUpNext && !canCurrentUserPick ? (
            <p className="rounded-large border border-primary-300/30 bg-primary-500/8 px-3 py-2 text-[11px] text-white/95">
              You are up next. Finalize your target before the current pick locks.
            </p>
          ) : null}
          {canCurrentUserPick && autopickPreviewLine ? (
            <div
              className={`flex items-center justify-between gap-2 rounded-large border px-3 py-2 text-[11px] ${
                isLowTimerWarning
                  ? "animate-pulse border-warning-300/45 bg-warning-500/10 text-white"
                  : "border-default-200/30 bg-content2/25 text-default-100"
              }`}
            >
              <p className="truncate">
                {autopickPreviewLine}
              </p>
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  isLowTimerWarning ? "bg-warning-300" : "bg-primary-300"
                }`}
              />
            </div>
          ) : null}

          {showDraftSettings ? (
            <div className="grid grid-cols-1 gap-2 rounded-large border border-default-200/35 bg-content2/35 p-3 text-xs md:grid-cols-2">
              <Button
                isDisabled={isRealtimeReadOnly}
                size="sm"
                variant="flat"
                onPress={() =>
                  setSettings((prev) => ({
                    ...prev,
                    requirePickConfirm: !prev.requirePickConfirm,
                  }))
                }
              >
                Fast Draft (no confirm): {settings.requirePickConfirm ? "Off" : "On"}
              </Button>
              <Button
                isDisabled={isRealtimeReadOnly}
                size="sm"
                variant="flat"
                onPress={() => toggleAutopickSetting("settings-panel")}
              >
                Queue autopick: {settings.autoPickFromQueue ? "On" : "Off"}
              </Button>
              <Button
                size="sm"
                variant="flat"
                onPress={() =>
                  setSettings((prev) => ({
                    ...prev,
                    vibrateOnTurn: !prev.vibrateOnTurn,
                  }))
                }
              >
                Mobile vibrate on turn: {settings.vibrateOnTurn ? "On" : "Off"}
              </Button>
              <p className="text-default-500">
                Autopick preview: <span className="font-medium">{autopickTargetLabel}</span>
              </p>
              <p className="text-default-500">
                Timeout fallback: <span className="font-medium">{serverTimeoutFallbackLabel}</span>
              </p>
            </div>
          ) : null}

          {roleWarningShouldShow ? (
            <p className="rounded-medium border border-warning-300/35 bg-warning-500/10 px-3 py-2 text-xs text-warning-200">
              Warning: {roleWarningContextLabel} role {formatRoleLabel(roleWarningTargetRole)} is already filled on your roster.
            </p>
          ) : null}
          {selectionNotice ? (
            <p className="rounded-medium border border-default-300/35 bg-content2/45 px-3 py-2 text-xs">
              {selectionNotice}
            </p>
          ) : null}
          {error ? <p className="text-sm text-danger-400">{error}</p> : null}
        </CardBody>
      </Card>
      </div>

      {isLobbyState ? (
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
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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

          <div className="space-y-2 md:hidden">
            {participantsByPosition.map((entry) => {
              const presence = presenceByUserId.get(entry.userId);
              const isCurrentUserRow = entry.userId === currentUserId;
              return (
                <div
                  key={entry.id}
                  className={`rounded-large border border-default-200/40 bg-content2/45 px-3 py-2.5 ${
                    isCurrentUserRow ? "border-primary-300/50 bg-primary-500/10" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">
                      #{entry.draftPosition} {entry.displayName}
                    </p>
                    {isCurrentUserRow ? (
                      <Chip color="primary" size="sm" variant="flat">
                        You
                      </Chip>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-default-500">Team: {entry.teamName ?? "Not set"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Chip color={presence?.isOnline ? "success" : "default"} size="sm" variant="flat">
                      <span className="inline-flex items-center gap-1">
                        {presence?.isOnline ? (
                          <Wifi className="h-3.5 w-3.5" />
                        ) : (
                          <WifiOff className="h-3.5 w-3.5" />
                        )}
                        {presence?.isOnline ? "Online" : "Offline"}
                      </span>
                    </Chip>
                    <Chip color={presence?.isReady ? "primary" : "default"} size="sm" variant="flat">
                      <span className="inline-flex items-center gap-1">
                        <SquareCheckBig className="h-3.5 w-3.5" />
                        {presence?.isReady ? "Ready" : "Not Ready"}
                      </span>
                    </Chip>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-hidden rounded-large border border-default-200/40 bg-content2/45 md:block">
            <ScrollShadow className="max-h-[30rem]" orientation="vertical">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-content2/95 text-xs uppercase tracking-wide text-default-500 backdrop-blur">
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
                        className={`border-t border-default-200/30 transition-colors ${
                          isCurrentUserRow
                            ? "bg-primary-500/10 hover:bg-primary-500/15"
                            : "hover:bg-default-100/20"
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
            </ScrollShadow>
          </div>
        </CardBody>
      </Card>
      ) : null}

      {draft.isCommissioner ? (
        <Drawer
          classNames={{
            wrapper: "z-[260]",
            base: "border-l border-default-200/40 bg-content1 text-default-foreground",
            backdrop: "bg-black/60",
          }}
          isOpen={isCommissionerDrawerOpen}
          placement="right"
          scrollBehavior="inside"
          size="sm"
          onOpenChange={(open) => setIsCommissionerDrawerOpen(open)}
        >
          <DrawerContent>
            <DrawerHeader className="border-b border-default-200/40 pb-3">
              <div className="space-y-1">
                <h2 className="flex items-center gap-2 text-lg font-semibold">
                  <Shield className="h-5 w-5 text-warning" />
                  Commissioner Controls
                </h2>
                <Chip size="sm" variant="flat">
                  Status: <span className="ml-1 font-semibold">{draft.status}</span>
                </Chip>
              </div>
            </DrawerHeader>
            <DrawerBody className="space-y-3 py-4">
              <div className="rounded-medium border border-default-200/40 bg-content2/40 px-3 py-2">
                <p className="inline-flex items-center gap-1 text-xs text-default-500">
                  <Gauge className="h-3.5 w-3.5" />
                  Use commissioner actions to control draft state.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
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
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      ) : null}

      {!isMobileViewport ? (
        <Drawer
          classNames={{
            wrapper: "z-[250]",
            base: "border-l border-default-200/40 bg-content1 text-default-foreground",
            backdrop: "bg-black/55",
          }}
          isOpen={isPlayerDetailDrawerOpen && Boolean(selectedPlayer)}
          placement="right"
          scrollBehavior="inside"
          size="sm"
          onOpenChange={(open) => setIsPlayerDetailDrawerOpen(open)}
        >
          <DrawerContent>
            <DrawerHeader className="border-b border-default-200/40 pb-3">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">
                  {selectedPlayer?.playerName ?? "Player details"}
                </h2>
                <p className="text-xs text-default-500">
                  {selectedPlayer
                    ? `${selectedPlayer.playerTeam ?? "—"} • ${formatRoleLabel(selectedPlayer.playerRole)}`
                    : "Select a player from the list"}
                </p>
              </div>
            </DrawerHeader>
            <DrawerBody className="space-y-3 py-4">
              {selectedPlayer && selectedPlayerInsights ? (
                <>
                  <div className="rounded-large border border-default-200/35 bg-content2/35 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
                      Performance (last 365 days)
                    </p>
                    <p className="mt-1 text-sm">
                      OVR:{" "}
                      <span className="font-semibold">
                        {selectedPlayerInsights.analytics?.overallRank
                          ? `#${selectedPlayerInsights.analytics.overallRank}`
                          : "Unranked"}
                      </span>{" "}
                      • POS:{" "}
                      <span className="font-semibold">
                        {selectedPlayerInsights.analytics?.positionRank
                          ? `#${selectedPlayerInsights.analytics.positionRank}`
                          : "Unranked"}
                      </span>
                    </p>
                    <p className="text-xs text-default-500">
                      Avg points/game:{" "}
                      <span className="font-semibold">
                        {selectedPlayerInsights.analytics?.averageFantasyPoints?.toFixed(2) ?? "N/A"}
                      </span>{" "}
                      • Games:{" "}
                      <span className="font-semibold">
                        {selectedPlayerInsights.analytics?.gamesPlayed ?? 0}
                      </span>{" "}
                      • Win rate:{" "}
                      <span className="font-semibold">
                        {typeof selectedPlayerInsights.analytics?.winRate === "number"
                          ? `${selectedPlayerInsights.analytics.winRate.toFixed(1)}%`
                          : "N/A"}
                      </span>
                    </p>
                    <p className="text-xs text-default-500">
                      Queue position:{" "}
                      {selectedPlayerInsights.queueIndex >= 0
                        ? `#${selectedPlayerInsights.queueIndex + 1}`
                        : "Not queued"}
                    </p>
                  </div>
                  <div className="rounded-large border border-default-200/35 bg-content2/35 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
                      Champion tendencies
                    </p>
                    {selectedPlayerInsights.analytics?.topChampions.length ? (
                      <ul className="mt-1 space-y-1.5">
                        {selectedPlayerInsights.analytics.topChampions.map((entry, index) => {
                          const championKey = `${selectedPlayer.playerName}-champ-${entry.champion}-${index}`;
                          const championIconCandidateUrl =
                            entry.championIconUrl ?? championDataDragonIconUrl(entry.champion);
                          const championIconUrl =
                            championIconCandidateUrl &&
                            !brokenChampionIconUrls.has(championIconCandidateUrl)
                              ? championIconCandidateUrl
                              : null;
                          const spriteStyle = championSpriteStyle(entry, 28);
                          return (
                            <li key={championKey} className="flex items-center justify-between gap-2">
                              <Popover
                                isOpen={openChampionPopoverKey === championKey}
                                placement="right"
                                showArrow
                                onOpenChange={(open) => {
                                  setOpenChampionPopoverKey((current) => {
                                    if (open) {
                                      return championKey;
                                    }
                                    return current === championKey ? null : current;
                                  });
                                }}
                              >
                                <PopoverTrigger>
                                  <button
                                    className="inline-flex items-center gap-2 rounded-medium px-1 py-0.5 text-left text-sm font-medium text-default-700 hover:bg-content3/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/70 dark:text-default-200"
                                    type="button"
                                    onBlur={() => {
                                      setOpenChampionPopoverKey((current) =>
                                        current === championKey ? null : current,
                                      );
                                    }}
                                    onFocus={() => setOpenChampionPopoverKey(championKey)}
                                    onMouseEnter={() => setOpenChampionPopoverKey(championKey)}
                                    onMouseLeave={() => {
                                      setOpenChampionPopoverKey((current) =>
                                        current === championKey ? null : current,
                                      );
                                    }}
                                  >
                                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-medium border border-default-200/60 bg-content3">
                                      {championIconUrl ? (
                                        <Image
                                          alt={`${entry.champion} icon`}
                                          className="h-full w-full object-cover"
                                          height={28}
                                          onError={() => markChampionIconUrlBroken(championIconUrl)}
                                          src={championIconUrl}
                                          unoptimized={isDataDragonChampionIconUrl(championIconUrl)}
                                          width={28}
                                        />
                                      ) : spriteStyle ? (
                                        <span
                                          aria-hidden
                                          className="block h-full w-full"
                                          style={spriteStyle}
                                        />
                                      ) : (
                                        <span className="text-[10px] font-semibold uppercase text-default-600">
                                          {championInitials(entry.champion)}
                                        </span>
                                      )}
                                    </span>
                                    <span>{entry.champion}</span>
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent
                                  className="max-w-[17rem]"
                                  onMouseEnter={() => setOpenChampionPopoverKey(championKey)}
                                  onMouseLeave={() => {
                                    setOpenChampionPopoverKey((current) =>
                                      current === championKey ? null : current,
                                    );
                                  }}
                                >
                                  <div className="space-y-0.5 px-1 py-1 text-xs">
                                    <p className="font-semibold">{entry.champion}</p>
                                    <p className="text-default-500">Games: {entry.games}</p>
                                    <p className="text-default-500">
                                      Win rate: {entry.winRate.toFixed(1)}%
                                    </p>
                                    <p className="text-default-500">
                                      Avg fantasy points: {entry.averageFantasyPoints.toFixed(2)}
                                    </p>
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <span className="text-xs text-default-500">
                                {formatChampionTendencyStats(entry)}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-default-500">
                        No champion history found for this player in the selected time window.
                      </p>
                    )}
                  </div>
                  <div className="rounded-large border border-default-200/35 bg-content2/35 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
                      Board context
                    </p>
                    <ul className="mt-1 space-y-1 text-sm">
                      {selectedPlayerInsights.reasons.map((reason) => (
                        <li key={reason} className="text-default-700 dark:text-default-300">
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      color={isSelectedPlayerQueued ? "primary" : "default"}
                      isDisabled={isSelectedPlayerQueued || !canQueueActions}
                      variant="flat"
                      onPress={() => addPlayerToQueue(selectedPlayer.playerName)}
                    >
                      {isSelectedPlayerQueued ? "Queued" : "Queue"}
                    </Button>
                    <Button
                      color="primary"
                      isDisabled={!canDraftActions}
                      variant="solid"
                      onPress={() => requestManualDraft(selectedPlayer.playerName)}
                    >
                      Draft now
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-sm text-default-500">No player selected.</p>
              )}
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      ) : null}

      {!isMobileViewport ? (
        <Drawer
          classNames={{
            wrapper: "z-[255]",
            base: "border-l border-default-200/40 bg-content1 text-default-foreground",
            backdrop: "bg-black/55",
          }}
          isOpen={isQueueDrawerOpen}
          placement="right"
          scrollBehavior="inside"
          size="sm"
          onOpenChange={(open) => setIsQueueDrawerOpen(open)}
        >
          <DrawerContent>
            <DrawerHeader className="border-b border-default-200/40 pb-3">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold">Pick Queue</h2>
                <p className="text-xs text-default-500">
                  Drag to reorder priority. Queue count: {queuedPlayers.length}
                </p>
              </div>
            </DrawerHeader>
            <DrawerBody className="relative overflow-hidden py-4">
              <Image
                alt=""
                aria-hidden
                className="pointer-events-none object-cover grayscale opacity-5"
                fill
                quality={100}
                sizes="(max-width: 768px) 100vw, 360px"
                src={QUEUE_BG_IMAGE_SRC}
                unoptimized
              />
              <div className="relative z-10 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Button
                    color={settings.autoPickFromQueue ? "primary" : "default"}
                    isDisabled={isRealtimeReadOnly}
                    size="sm"
                    variant="flat"
                    onPress={() => toggleAutopickSetting("queue-drawer")}
                  >
                    Autopick {settings.autoPickFromQueue ? "On" : "Off"}
                  </Button>
                  <Button
                    isDisabled={pickQueue.length === 0 || !canQueueActions}
                    size="sm"
                    variant="light"
                    onPress={clearQueue}
                  >
                    Clear
                  </Button>
                </div>
                <p className="text-xs text-default-500">Uses queue first, then Best Available.</p>
                {queueAutopickTargetLine ? (
                  <p className="text-xs text-default-500">{queueAutopickTargetLine}</p>
                ) : null}
                {autopickCountdownSeconds !== null ? (
                  <p className="text-xs text-warning-300">
                    {`Autopick in ${autopickCountdownSeconds}s: ${autopickTargetLabel}`}
                  </p>
                ) : null}
                {showQueueEmptyAutopickWarning ? (
                  <p className="text-xs text-warning-300">
                    {queueAutopickWarningMessage}
                  </p>
                ) : null}
                {isRealtimeReadOnly ? (
                  <p className="text-xs text-warning-300">
                    Realtime reconnecting. Queue edits are read-only.
                  </p>
                ) : null}
                {canCurrentUserPick && queuedPlayers.length === 0 ? (
                  <p className="text-xs text-default-500">Queue your top 3 so autopick is safe.</p>
                ) : null}
                <ScrollShadow
                  className="min-h-[16rem] rounded-large border border-default-200/35 bg-content2/35"
                  orientation="vertical"
                >
                  {queuedPlayers.length === 0 ? (
                    <p className="p-3 text-sm text-default-500">Queue is empty.</p>
                  ) : (
                    <ul className="divide-y divide-default-200/30">
                      {queuedPlayers.map((player, index) => (
                      <li
                        key={player.playerName}
                        className={`flex items-center gap-2 px-3 py-2 ${index === 0 ? "bg-primary-500/10" : ""}`}
                        draggable={canQueueActions}
                        onDragEnd={() => setDraggedQueueIndex(null)}
                        onDragOver={(event) => {
                          if (!canQueueActions) {
                            return;
                          }
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDragStart={() => {
                          if (!canQueueActions) {
                            return;
                          }
                          setDraggedQueueIndex(index);
                        }}
                        onDrop={() => {
                          if (!canQueueActions || draggedQueueIndex === null) {
                            return;
                          }
                          moveQueueItem(draggedQueueIndex, index);
                          setDraggedQueueIndex(null);
                        }}
                      >
                        <span className="text-xs font-semibold text-default-500">{index + 1}</span>
                        <GripVertical className="h-4 w-4 shrink-0 text-default-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{player.playerName}</p>
                          <p className="truncate text-xs text-default-500">
                            {[player.playerTeam, formatRoleLabel(player.playerRole)].filter(Boolean).join(" • ")}
                          </p>
                        </div>
                        <Button
                          isIconOnly
                          isDisabled={!canQueueActions}
                          size="sm"
                          variant="light"
                          onPress={() => removePlayerFromQueue(player.playerName)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                      ))}
                    </ul>
                  )}
                </ScrollShadow>
              </div>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      ) : null}

      {isLiveState ? (
        <>
          {isMobileViewport ? (
          <div>
            <Tabs
              aria-label="Live draft mobile tabs"
              color="primary"
              selectedKey={mobileLiveTab}
              size="sm"
              variant="underlined"
              onSelectionChange={(key) => setMobileLiveTab(String(key))}
            >
              <Tab key="players" title="Players">
                <Card className="border border-primary-300/30 bg-content1/80">
                  <CardBody className="space-y-3">
                    <div className="grid grid-cols-1 gap-2">
                      <Input
                        label="Search"
                        labelPlacement="outside"
                        placeholder="Search player, team, or role"
                        size="sm"
                        startContent={<Search className="h-4 w-4 text-default-500" />}
                        value={searchInputValue}
                        onValueChange={setSearchInputValue}
                      />
                      <label className="text-xs text-default-500">
                        Sort
                        <select
                          className="mt-1 w-full rounded-medium border border-default-300/40 bg-content1 px-2 py-1.5 text-sm"
                          value={playerSort}
                          onChange={(event) => setPlayerSort(event.target.value as PlayerSortKey)}
                        >
                          <option value="name">Name</option>
                          <option value="rank">OVR Rank</option>
                          <option value="pos">POS Rank</option>
                          <option value="team">Team</option>
                          <option value="role">Role</option>
                        </select>
                      </label>
                      <Button
                        color={showNeededRolesOnly ? "primary" : "default"}
                        size="sm"
                        variant="flat"
                        onPress={() => setShowNeededRolesOnly((prev) => !prev)}
                      >
                        {showNeededRolesOnly ? "Showing needed roles only" : "Show needed roles only"}
                      </Button>
                    </div>
                    <ScrollShadow className="pb-1" orientation="horizontal">
                      <Tabs
                        aria-label="Position filter"
                        className="mx-auto w-max"
                        color="primary"
                        selectedKey={roleFilter}
                        size="sm"
                        variant="underlined"
                        onSelectionChange={(key) => applyRoleFilter(String(key))}
                      >
                        {roleFilters.map((filter) => (
                          <Tab
                            key={filter.value}
                            isDisabled={filter.value !== "ALL" && filter.count === 0}
                            title={`${filter.label} (${filter.count})${filter.isScarce ? " • Low" : ""}`}
                          />
                        ))}
                      </Tabs>
                    </ScrollShadow>
                    <div className="space-y-2">
                      {displayAvailablePlayers.map((player) => {
                        const isQueued = queuedPlayerNameSet.has(player.playerName);
                        const isSelected = selectedPlayerName === player.playerName;
                        return (
                          <div
                            key={player.id}
                            aria-label={`Select ${player.playerName}`}
                            className={`w-full rounded-large border border-default-200/35 bg-content2/30 px-3 py-3 text-left transition ${
                              isSelected
                                ? "ring-1 ring-primary-300/65"
                                : isQueued
                                ? "ring-1 ring-primary-300/35"
                                : ""
                            }`}
                            role="button"
                            tabIndex={0}
                            onClick={(event) => handlePlayerTapOrClick(player.playerName, event)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                setSelectedPlayerName(player.playerName);
                              }
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                {player.teamIconUrl ? (
                                  isMobileViewport ? (
                                    <Popover placement="top" showArrow>
                                      <PopoverTrigger>
                                        <button
                                          aria-label={`Show team for ${player.playerName}`}
                                          className="shrink-0 rounded-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/70"
                                          type="button"
                                          onClick={(event) => event.stopPropagation()}
                                          onPointerDown={(event) => event.stopPropagation()}
                                        >
                                          <CroppedTeamLogo
                                            alt={`${player.playerName} team logo`}
                                            frameClassName="h-5 w-7"
                                            height={20}
                                            imageClassName="h-5"
                                            src={player.teamIconUrl}
                                            width={48}
                                          />
                                        </button>
                                      </PopoverTrigger>
                                      <PopoverContent>
                                        <p className="px-1 py-0.5 text-xs">{player.playerTeam ?? "Unknown team"}</p>
                                      </PopoverContent>
                                    </Popover>
                                  ) : (
                                    <Tooltip content={player.playerTeam ?? "Unknown team"}>
                                      <button
                                        aria-label={`Show team for ${player.playerName}`}
                                        className="shrink-0 rounded-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/70"
                                        type="button"
                                        onClick={(event) => event.stopPropagation()}
                                        onPointerDown={(event) => event.stopPropagation()}
                                      >
                                        <CroppedTeamLogo
                                          alt={`${player.playerName} team logo`}
                                          frameClassName="h-5 w-7"
                                          height={20}
                                          imageClassName="h-5"
                                          src={player.teamIconUrl}
                                          width={48}
                                        />
                                      </button>
                                    </Tooltip>
                                  )
                                ) : null}
                                <p className="truncate text-sm font-semibold">{player.playerName}</p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                {player.analytics?.overallRank ? (
                                  <Chip
                                    className="border border-sky-300/45 bg-sky-400/20 text-sky-100"
                                    size="sm"
                                    variant="flat"
                                  >
                                    OVR #{player.analytics.overallRank}
                                  </Chip>
                                ) : null}
                                {player.analytics?.positionRank ? (
                                  <Chip
                                    className="border border-amber-300/45 bg-amber-400/20 text-amber-100"
                                    size="sm"
                                    variant="flat"
                                  >
                                    POS #{player.analytics.positionRank}
                                  </Chip>
                                ) : null}
                                <Chip className={roleChipClassName(player.playerRole)} size="sm" variant="flat">
                                  {formatRoleLabel(player.playerRole)}
                                </Chip>
                              </div>
                            </div>
                            <p className="mt-1.5 text-[11px] text-default-500">
                              Avg pts/g:{" "}
                              {typeof player.analytics?.averageFantasyPoints === "number"
                                ? player.analytics.averageFantasyPoints.toFixed(2)
                                : "N/A"}
                            </p>
                            <div className="mt-2 flex items-center gap-2">
                              <Button
                                isIconOnly
                                aria-label={isQueued ? "Queued" : "Queue player"}
                                color={isQueued ? "primary" : "default"}
                                isDisabled={isQueued || !canQueueActions}
                                size="sm"
                                variant={isQueued ? "flat" : "light"}
                                onPress={() => addPlayerToQueue(player.playerName)}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                              {canCurrentUserPick ? (
                                <Button
                                  color="primary"
                                  isDisabled={!canDraftActions}
                                  size="sm"
                                  variant="flat"
                                  onPress={() => requestManualDraft(player.playerName)}
                                >
                                  Draft
                                </Button>
                              ) : (
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="light"
                                  onPress={() => setSelectedPlayerName(player.playerName)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>
              </Tab>
              <Tab key="team" title={`My Team (${userPicks.length})`}>
                <Card className="border border-default-200/40 bg-content1/80">
                  <CardBody className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-default-500">Queue: {queuedPlayers.length}</p>
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => setMobileLiveTab("queue")}
                      >
                        View Queue
                      </Button>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-default-500">Needs</p>
                      {rosterNeeds.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {rosterNeeds.map((role) => (
                            <Button
                              key={role}
                              size="sm"
                              variant="flat"
                              onPress={() => {
                                applyRoleFilter(role);
                                setMobileLiveTab("players");
                              }}
                            >
                              {role}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <Chip size="sm" variant="flat">
                          All core slots filled
                        </Chip>
                      )}
                      {bestNeedSuggestion ? (
                        <Button
                          size="sm"
                          variant="light"
                          onPress={() => {
                            applyRoleFilter(bestNeedSuggestion.role);
                            setSelectedPlayerName(bestNeedSuggestion.playerName);
                            setMobileLiveTab("players");
                          }}
                        >
                          Best available: {bestNeedSuggestion.playerName} ({bestNeedSuggestion.role})
                        </Button>
                      ) : null}
                    </div>
                    {PRIMARY_ROLE_FILTERS.map((role) => {
                      const pick = rosterSlots.byRole.get(role);
                      const pickImageUrl = pickPlayerImageUrl(pick);
                      return (
                        <div
                          key={role}
                          className="flex items-center justify-between rounded-medium border border-default-200/30 px-3 py-2 text-sm"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="font-medium">{role}</span>
                            {pick ? (
                              pickImageUrl ? (
                                <Image
                                  alt={`${pick.playerName} portrait`}
                                  className="h-5 w-5 rounded-full border border-default-300/50 object-cover"
                                  height={20}
                                  src={pickImageUrl}
                                  width={20}
                                />
                              ) : pick.teamIconUrl ? (
                                <CroppedTeamLogo
                                  alt={`${pick.playerName} team logo`}
                                  frameClassName="h-5 w-6"
                                  height={20}
                                  imageClassName="h-5"
                                  src={pick.teamIconUrl}
                                  width={24}
                                />
                              ) : null
                            ) : null}
                          </div>
                          <span className="truncate text-default-500">{pick?.playerName ?? "Pick Pending"}</span>
                        </div>
                      );
                    })}
                    {rosterSlots.overflow.length > 0 ? (
                      <div className="rounded-medium border border-default-200/30 px-3 py-2 text-sm">
                        <p className="text-xs uppercase tracking-wide text-default-500">Bench</p>
                        {rosterSlots.overflow.map((pick) => (
                          <p key={pick.id}>{pick.playerName}</p>
                        ))}
                      </div>
                    ) : null}
                  </CardBody>
                </Card>
              </Tab>
              <Tab key="queue" title={`Queue (${queuedPlayers.length})`}>
                <Card className="relative overflow-hidden border border-default-200/40 bg-content1/80">
                  <Image
                    alt=""
                    aria-hidden
                    className="pointer-events-none object-cover grayscale opacity-5"
                    fill
                    quality={100}
                    sizes="100vw"
                    src={QUEUE_BG_IMAGE_SRC}
                    unoptimized
                  />
                  <CardBody className="relative z-10 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        color={settings.autoPickFromQueue ? "primary" : "default"}
                        isDisabled={isRealtimeReadOnly}
                        size="sm"
                        variant="flat"
                        onPress={() => toggleAutopickSetting("mobile-queue-tab")}
                      >
                        Autopick {settings.autoPickFromQueue ? "On" : "Off"}
                      </Button>
                      <Button
                        isDisabled={pickQueue.length === 0 || !canQueueActions}
                        size="sm"
                        variant="light"
                        onPress={clearQueue}
                      >
                        Clear
                      </Button>
                    </div>
                    <p className="text-xs text-default-500">Queue priority order (top picks first).</p>
                    {queueAutopickTargetLine ? (
                      <p className="text-xs text-default-500">{queueAutopickTargetLine}</p>
                    ) : null}
                    {autopickCountdownSeconds !== null ? (
                      <p className="text-xs text-warning-300">
                        {`Autopick in ${autopickCountdownSeconds}s: ${autopickTargetLabel}`}
                      </p>
                    ) : null}
                    {showQueueEmptyAutopickWarning ? (
                      <p className="text-xs text-warning-300">
                        {queueAutopickWarningMessage}
                      </p>
                    ) : null}
                    {isRealtimeReadOnly ? (
                      <p className="text-xs text-warning-300">
                        Realtime reconnecting. Queue edits are read-only.
                      </p>
                    ) : null}
                    {canCurrentUserPick && queuedPlayers.length === 0 ? (
                      <p className="text-xs text-default-500">Queue your top 3 so autopick is safe.</p>
                    ) : null}
                    <ScrollShadow
                      className="max-h-[55svh] rounded-large border border-default-200/35 bg-content2/35"
                      orientation="vertical"
                    >
                      {queuedPlayers.length === 0 ? (
                        <p className="p-3 text-sm text-default-500">Queue is empty.</p>
                      ) : (
                        <ul className="divide-y divide-default-200/30">
                          {queuedPlayers.map((player, index) => (
                            <li
                              key={player.playerName}
                              className={`flex items-center gap-2 px-3 py-2 ${
                                index === 0 ? "bg-primary-500/10" : ""
                              }`}
                            >
                              <span className="text-xs font-semibold text-default-500">{index + 1}</span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{player.playerName}</p>
                                <p className="truncate text-xs text-default-500">
                                  {[player.playerTeam, formatRoleLabel(player.playerRole)].filter(Boolean).join(" • ")}
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  isIconOnly
                                  isDisabled={!canQueueActions || index === 0}
                                  size="sm"
                                  variant="light"
                                  onPress={() => moveQueueItem(index, index - 1)}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  isIconOnly
                                  isDisabled={!canQueueActions || index === queuedPlayers.length - 1}
                                  size="sm"
                                  variant="light"
                                  onPress={() => moveQueueItem(index, index + 1)}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button
                                  isIconOnly
                                  isDisabled={!canQueueActions}
                                  size="sm"
                                  variant="light"
                                  onPress={() => removePlayerFromQueue(player.playerName)}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </ScrollShadow>
                  </CardBody>
                </Card>
              </Tab>
            </Tabs>
          </div>
          ) : null}

          {!isMobileViewport ? (
          <div className="grid h-[clamp(38rem,74vh,52rem)] min-h-[38rem] grid-cols-[320px_minmax(0,1fr)_360px] items-stretch gap-4">
            <Card
              className={`relative overflow-hidden border border-default-200/40 bg-content1/80 shadow-sm ${
                queuedPlayers.length === 0 ? "h-auto min-h-0 self-start" : "h-full min-h-0"
              } ${showReadOnlyInteractionOverlay ? "cursor-not-allowed" : ""}`}
              title={showReadOnlyInteractionOverlay ? "Disabled while reconnecting" : undefined}
            >
              <Image
                alt=""
                aria-hidden
                className="pointer-events-none object-cover grayscale opacity-5"
                fill
                quality={100}
                sizes="320px"
                src={QUEUE_BG_IMAGE_SRC}
                unoptimized
              />
              <CardBody className={`relative z-10 ${queuedPlayers.length === 0 ? "space-y-3 p-3" : "flex h-full min-h-0 flex-col gap-3 p-3"}`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-default-500">
                    Queue ({queuedPlayers.length})
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      color={settings.autoPickFromQueue ? "primary" : "default"}
                      isDisabled={isRealtimeReadOnly}
                      size="sm"
                      variant="flat"
                      onPress={() => toggleAutopickSetting("queue-panel")}
                    >
                      Autopick {settings.autoPickFromQueue ? "On" : "Off"}
                    </Button>
                    <Button
                      isDisabled={pickQueue.length === 0 || !canQueueActions}
                      size="sm"
                      variant="light"
                      onPress={clearQueue}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-default-500">Drag to reorder. Queue is autopick priority.</p>
                {queueAutopickTargetLine ? (
                  <p className="text-xs text-default-500">{queueAutopickTargetLine}</p>
                ) : null}
                {autopickCountdownSeconds !== null ? (
                  <p className="text-xs text-warning-300">
                    {`Autopick in ${autopickCountdownSeconds}s: ${autopickTargetLabel}`}
                  </p>
                ) : null}
                {showQueueEmptyAutopickWarning ? (
                  <p className="text-xs text-warning-300">
                    {queueAutopickWarningMessage}
                  </p>
                ) : null}
                {isRealtimeReadOnly ? (
                  <p className="text-xs text-warning-300">
                    Realtime reconnecting. Queue edits are read-only.
                  </p>
                ) : null}
                {queuedPlayers.length === 0 ? (
                  <div className="rounded-large border border-default-200/35 bg-content2/35 p-3">
                    <p className="text-sm font-medium">Queue your top 3 so autopick is safe.</p>
                    <p className="mt-1 text-xs text-default-500">
                      Start with your highest-priority picks so timeout fallback stays predictable.
                    </p>
                    {quickQueueSuggestions.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {quickQueueSuggestions.map((suggestion) => (
                          <Button
                            key={`queue-suggestion-${suggestion.playerName}`}
                            isDisabled={!canQueueActions}
                            size="sm"
                            variant="flat"
                            onPress={() => addPlayerToQueue(suggestion.playerName)}
                          >
                            {suggestion.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <ScrollShadow
                    className="min-h-0 flex-1 rounded-large border border-default-200/35 bg-content2/35"
                    orientation="vertical"
                  >
                    <ul className="divide-y divide-default-200/30">
                      {queuedPlayers.map((player, index) => {
                        const queuedRoleIconUrl = roleIconUrl(player.playerRole);
                        return (
                          <li
                            key={player.playerName}
                            className={`flex items-center gap-2 px-3 py-2 ${
                              index === 0 ? "bg-primary-500/10" : ""
                            }`}
                            draggable={canQueueActions}
                            onDragEnd={() => setDraggedQueueIndex(null)}
                            onDragOver={(event) => {
                              if (!canQueueActions) {
                                return;
                              }
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }}
                            onDragStart={() => {
                              if (!canQueueActions) {
                                return;
                              }
                              setDraggedQueueIndex(index);
                            }}
                            onDrop={() => {
                              if (!canQueueActions || draggedQueueIndex === null) {
                                return;
                              }
                              moveQueueItem(draggedQueueIndex, index);
                              setDraggedQueueIndex(null);
                            }}
                          >
                            <span className="text-xs font-semibold text-default-500">{index + 1}</span>
                            <GripVertical className="h-4 w-4 shrink-0 text-default-400" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{player.playerName}</p>
                              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-default-500">
                                {queuedRoleIconUrl ? (
                                  <Image
                                    alt={`${formatRoleLabel(player.playerRole)} role icon`}
                                    className="h-4 w-4 rounded-sm object-contain"
                                    height={16}
                                    src={queuedRoleIconUrl}
                                    width={16}
                                  />
                                ) : null}
                                {player.teamIconUrl ? (
                                  <CroppedTeamLogo
                                    alt={`${player.playerName} team logo`}
                                    frameClassName="h-4 w-6"
                                    height={16}
                                    imageClassName="h-4"
                                    src={player.teamIconUrl}
                                    width={24}
                                  />
                                ) : null}
                              </div>
                            </div>
                            <Button
                              isIconOnly
                              isDisabled={!canQueueActions}
                              size="sm"
                              variant="light"
                              onPress={() => removePlayerFromQueue(player.playerName)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollShadow>
                )}
                <Button
                  className="w-full"
                  color="primary"
                  isDisabled={!draftActionPlayerName || !canDraftActions}
                  isLoading={pickPending}
                  onPress={() => requestManualDraft()}
                >
                  {isRealtimeReadOnly
                    ? "Reconnecting - drafting disabled"
                    : canCurrentUserPick
                    ? draftActionPlayerName
                      ? `You're on the clock - Draft ${draftActionPlayerName}`
                      : "You're on the clock - select a player"
                    : isUpNext
                    ? "You're up next"
                    : yourNextPickMeta
                    ? `You pick in ${yourNextPickMeta.picksAway} picks (~${formatEtaFromMs(yourNextPickMeta.etaMs)})`
                    : "Waiting for your turn"}
                </Button>
              </CardBody>
              {showReadOnlyInteractionOverlay ? (
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[inherit] bg-content1/55 backdrop-blur-[1px]">
                  <div className="rounded-medium border border-warning-300/60 bg-content1/92 px-3 py-2 text-center text-xs shadow-md">
                    <p className="inline-flex items-center gap-1 font-semibold text-warning-200">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Reconnecting...
                    </p>
                    <p className="mt-1 text-default-500">Queue actions disabled until sync is restored.</p>
                  </div>
                </div>
              ) : null}
            </Card>

            <Card
              className={`relative h-full min-h-0 overflow-hidden border bg-content1/80 shadow-sm ${
                canCurrentUserPick
                  ? "border-primary-300/65 shadow-[0_0_0_1px_rgba(147,197,253,0.4),0_0_18px_rgba(59,130,246,0.2)]"
                  : "border-primary-400/30"
              } ${showReadOnlyInteractionOverlay ? "cursor-not-allowed" : ""}`}
              title={showReadOnlyInteractionOverlay ? "Disabled while reconnecting" : undefined}
            >
              <CardBody className="flex min-h-0 flex-1 flex-col gap-3">
                {canCurrentUserPick || hasPendingManualConfirm ? (
                  <div
                    className={`sticky top-0 z-20 rounded-large border px-3 py-2 shadow-sm backdrop-blur ${
                      hasPendingManualConfirm
                        ? "border-warning-300/60 bg-warning-500/14"
                        : "border-primary-300/55 bg-primary-500/12"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
                          {hasPendingManualConfirm ? "Confirm pick" : "On the clock"}
                        </p>
                        {hasPendingManualConfirm && pendingManualDraftPlayer ? (
                          <div className="space-y-1">
                            <p className="truncate text-sm font-semibold">
                              {pendingManualDraftPlayer.playerName} ({formatRoleLabel(pendingManualDraftPlayer.playerRole)})
                            </p>
                            <div className="flex items-center gap-2 text-xs text-default-500">
                              {pendingManualDraftPlayer.teamIconUrl ? (
                                <CroppedTeamLogo
                                  alt={`${pendingManualDraftPlayer.playerName} team logo`}
                                  frameClassName="h-4 w-6"
                                  height={16}
                                  imageClassName="h-4"
                                  src={pendingManualDraftPlayer.teamIconUrl}
                                  width={32}
                                />
                              ) : null}
                              <span>{pendingManualDraftPlayer.playerTeam ?? "Unknown team"}</span>
                              {pendingManualSlotImpact ? (
                                <span className="rounded-small border border-default-200/40 px-1.5 py-0.5">
                                  Fills: {pendingManualSlotImpact.fills}
                                </span>
                              ) : null}
                            </div>
                            {pendingManualSlotImpact?.warning ? (
                              <p className="text-xs text-warning-200">{pendingManualSlotImpact.warning}</p>
                            ) : null}
                          </div>
                        ) : (
                          <>
                            <p className="truncate text-sm font-semibold">
                              {selectedPlayer
                                ? `Selected: ${selectedPlayer.playerName} (${formatRoleLabel(selectedPlayer.playerRole)})`
                                : draftActionPlayerName
                                ? `Queued target: ${draftActionPlayerName}`
                                : "Select a player"}
                            </p>
                            <p className="text-xs text-default-500">
                              {settings.requirePickConfirm
                                ? "Draft opens a confirmation step."
                                : "Fast Draft enabled: submit is immediate."}
                            </p>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {hasPendingManualConfirm ? (
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() => setPendingManualDraftPlayerName(null)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        {hasPendingManualConfirm && settings.requirePickConfirm ? (
                          <Button
                            size="sm"
                            variant="light"
                            onPress={() =>
                              setSettings((prev) => ({
                                ...prev,
                                requirePickConfirm: false,
                              }))
                            }
                          >
                            Don&apos;t ask again
                          </Button>
                        ) : null}
                        {!hasPendingManualConfirm ? (
                          <Button
                            color={selectedPlayer && isSelectedPlayerQueued ? "primary" : "default"}
                            isDisabled={
                              !selectedPlayer ||
                              isSelectedPlayerQueued ||
                              !canQueueActions
                            }
                            size="sm"
                            variant="flat"
                            onPress={() => {
                              if (!selectedPlayer) {
                                return;
                              }
                              addPlayerToQueue(selectedPlayer.playerName);
                            }}
                          >
                            {selectedPlayer && isSelectedPlayerQueued
                              ? "Queued"
                              : "Queue"}
                          </Button>
                        ) : null}
                        <Button
                          className={isLowTimerWarning ? "animate-pulse" : ""}
                          color="primary"
                          isDisabled={
                            hasPendingManualConfirm
                              ? !pendingManualDraftPlayerName || !canDraftActions
                              : !draftActionPlayerName || !canDraftActions
                          }
                          isLoading={pickPending}
                          size="sm"
                          onPress={() => {
                            if (hasPendingManualConfirm && pendingManualDraftPlayerName) {
                              void submitPick(pendingManualDraftPlayerName, { source: "manual" });
                              return;
                            }
                            requestManualDraft();
                          }}
                        >
                          {hasPendingManualConfirm ? "Confirm draft" : "Draft now"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="rounded-large border border-default-200/30 bg-content2/25 px-2 py-1.5">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-default-500">
                    Role filter
                  </p>
                  <ScrollShadow className="pb-1" orientation="horizontal">
                    <Tabs
                      aria-label="Position filter"
                      className="mx-auto w-max"
                      color="primary"
                      selectedKey={roleFilter}
                      size="sm"
                      variant="underlined"
                      onSelectionChange={(key) => applyRoleFilter(String(key))}
                    >
                      {roleFilters.map((filter) => (
                        <Tab
                          key={filter.value}
                          isDisabled={filter.value !== "ALL" && filter.count === 0}
                          title={`${filter.label} (${filter.count})${filter.isScarce ? " • Low" : ""}`}
                        />
                      ))}
                    </Tabs>
                  </ScrollShadow>
                </div>
                <div className="rounded-large border border-default-200/35 bg-content2/35 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        color={showNeededRolesOnly ? "primary" : "default"}
                        size="sm"
                        variant={showNeededRolesOnly ? "solid" : "flat"}
                        onPress={() => setShowNeededRolesOnly((prev) => !prev)}
                      >
                        {showNeededRolesOnly ? "Needs only: On" : "Needs only: Off"}
                      </Button>
                      {hasAnyPlayerFilter ? (
                        <Button
                          size="sm"
                          variant="light"
                          onPress={resetPlayerFilters}
                        >
                          Reset filters
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-[11px] text-default-500">
                      {hasAnyPlayerFilter
                        ? `${activePlayerFilterCount} filter${activePlayerFilterCount === 1 ? "" : "s"} active`
                        : "No active filters"}
                    </p>
                  </div>
                  {showNeededRolesOnly ? (
                    <p className="mt-1 text-[11px] text-primary-200">Showing roles you still need</p>
                  ) : null}
                  <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_180px]">
                    <Input
                      aria-label="Search players"
                      id="draft-player-search"
                      placeholder="Search player, team, or role"
                      size="sm"
                      startContent={<Search className="h-4 w-4 text-default-500" />}
                      value={searchInputValue}
                      onValueChange={setSearchInputValue}
                    />
                    <select
                      aria-label="Sort players"
                      className="w-full rounded-medium border border-default-300/40 bg-content1 px-2 py-1.5 text-sm"
                      value={playerSort}
                      onChange={(event) => setPlayerSort(event.target.value as PlayerSortKey)}
                    >
                      <option value="name">Name</option>
                      <option value="rank">OVR Rank</option>
                      <option value="pos">POS Rank</option>
                      <option value="team">Team</option>
                      <option value="role">Role</option>
                    </select>
                  </div>
                </div>
                <div className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-large border border-default-200/40 bg-content2/45">
                  <div className="grid grid-cols-3 bg-content2/95">
                    <p className="flex h-9 translate-x-[clamp(1px,0.25vw,4px)] items-center justify-center border-b border-default-200/40 px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-default-500">
                      Player
                    </p>
                    <p className="flex h-9 translate-x-[clamp(1px,0.25vw,4px)] items-center justify-center border-b border-default-200/40 px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-default-500">
                      Role
                    </p>
                    <p className="flex h-9 translate-x-[clamp(1px,0.25vw,4px)] items-center justify-center border-b border-default-200/40 px-2 text-center text-[11px] font-semibold uppercase tracking-wide text-default-500">
                      Actions
                    </p>
                  </div>
                  <ScrollShadow className="min-h-0 flex-1" orientation="vertical">
                    <HeroTable
                      removeWrapper
                      aria-label="Available players table"
                      classNames={{
                        base: "w-full",
                        table: "w-full table-fixed",
                        thead: "hidden",
                        th: "hidden",
                        td: "h-11 border-b border-default-200/30 px-2 py-1.5 align-middle",
                        tr: "transition last:[&>td]:border-b-0 data-[hover=true]:bg-content2/70",
                      }}
                    >
                      <TableHeader>
                        <TableColumn key="player" className="w-1/3">Player</TableColumn>
                        <TableColumn key="role" className="w-1/3 text-center">Role</TableColumn>
                        <TableColumn key="actions" className="w-1/3 text-center">Actions</TableColumn>
                      </TableHeader>
                      <TableBody
                        emptyContent={<span className="text-xs text-default-500">No players found.</span>}
                      >
                        {displayAvailablePlayers.map((player) => {
                          const isQueued = queuedPlayerNameSet.has(player.playerName);
                          const isSelected = selectedPlayerName === player.playerName;
                          const playerRoleIconUrl = roleIconUrl(player.playerRole);
                          return (
                            <TableRow
                              key={player.id}
                              className={`${isRealtimeReadOnly ? "cursor-not-allowed" : "cursor-pointer"} border-t border-default-200/30 transition ${
                                isSelected
                                  ? "shadow-[inset_0_0_0_1px_rgba(147,197,253,0.7)]"
                                  : isQueued
                                  ? "shadow-[inset_0_0_0_1px_rgba(147,197,253,0.4)]"
                                  : ""
                              }`}
                              onClick={(event) => {
                                if (isRealtimeReadOnly) {
                                  return;
                                }
                                handlePlayerTapOrClick(player.playerName, event);
                              }}
                            >
                              <TableCell className="w-1/3">
                                <div className="mx-auto flex w-fit min-w-0 translate-x-[clamp(1px,0.25vw,4px)] items-center gap-2">
                                  {player.teamIconUrl ? (
                                    isMobileViewport ? (
                                      <Popover placement="top" showArrow>
                                        <PopoverTrigger>
                                          <button
                                            aria-label={`Show team for ${player.playerName}`}
                                            className="shrink-0 rounded-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/70"
                                            type="button"
                                            onClick={(event) => event.stopPropagation()}
                                            onPointerDown={(event) => event.stopPropagation()}
                                          >
                                            <CroppedTeamLogo
                                              alt={`${player.playerName} team logo`}
                                              frameClassName="h-5 w-7"
                                              height={20}
                                              imageClassName="h-5"
                                              src={player.teamIconUrl}
                                              width={48}
                                            />
                                          </button>
                                        </PopoverTrigger>
                                        <PopoverContent>
                                          <p className="px-1 py-0.5 text-xs">{player.playerTeam ?? "Unknown team"}</p>
                                        </PopoverContent>
                                      </Popover>
                                    ) : (
                                      <Tooltip content={player.playerTeam ?? "Unknown team"}>
                                        <button
                                          aria-label={`Show team for ${player.playerName}`}
                                          className="shrink-0 rounded-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300/70"
                                          type="button"
                                          onClick={(event) => event.stopPropagation()}
                                          onPointerDown={(event) => event.stopPropagation()}
                                        >
                                          <CroppedTeamLogo
                                            alt={`${player.playerName} team logo`}
                                            frameClassName="h-5 w-7"
                                            height={20}
                                            imageClassName="h-5"
                                            src={player.teamIconUrl}
                                            width={48}
                                          />
                                        </button>
                                      </Tooltip>
                                    )
                                  ) : null}
                                  <div className="min-w-0 text-left">
                                    <p className="truncate font-medium">{player.playerName}</p>
                                    {player.analytics?.overallRank || player.analytics?.positionRank ? (
                                      <p className="text-[11px] text-sky-300">
                                        {player.analytics?.overallRank ? `OVR #${player.analytics.overallRank}` : "OVR —"}
                                        {player.analytics?.positionRank
                                          ? ` • POS #${player.analytics.positionRank}`
                                          : " • POS —"}
                                      </p>
                                    ) : null}
                                    <p className="text-[11px] text-default-500">
                                      Avg pts/g:{" "}
                                      {typeof player.analytics?.averageFantasyPoints === "number"
                                        ? player.analytics.averageFantasyPoints.toFixed(2)
                                        : "N/A"}
                                    </p>
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="w-1/3 whitespace-nowrap text-center">
                                {playerRoleIconUrl ? (
                                  <div className="mx-auto flex w-full translate-x-[clamp(1px,0.25vw,4px)] items-center justify-center">
                                    <Image
                                      alt={`${formatRoleLabel(player.playerRole)} role icon`}
                                      className="h-5 w-5 rounded-sm object-contain"
                                      height={20}
                                      src={playerRoleIconUrl}
                                      width={20}
                                    />
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-default-500">
                                    {formatRoleLabel(player.playerRole)}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="w-1/3 whitespace-nowrap">
                                <div className="mx-auto flex w-full translate-x-[clamp(1px,0.25vw,4px)] items-center justify-center gap-1.5">
                                  <Tooltip content={isQueued ? "Already in queue" : "Add to queue"}>
                                    <span
                                      className="inline-flex"
                                      onClick={(event) => event.stopPropagation()}
                                      onPointerDown={(event) => event.stopPropagation()}
                                    >
                                      <Button
                                        isIconOnly
                                        aria-label={isQueued ? "Queued" : "Queue player"}
                                        color={isQueued ? "primary" : "default"}
                                        isDisabled={isQueued || !canQueueActions}
                                        size="sm"
                                        variant={isQueued ? "flat" : "light"}
                                        onPress={() => addPlayerToQueue(player.playerName)}
                                      >
                                        <Plus className="h-4 w-4" />
                                      </Button>
                                    </span>
                                  </Tooltip>
                                  {canCurrentUserPick ? (
                                    <Button
                                      color="primary"
                                      isDisabled={!canDraftActions}
                                      size="sm"
                                      variant="solid"
                                      onPress={() => requestManualDraft(player.playerName)}
                                    >
                                      Draft
                                    </Button>
                                  ) : (
                                    <Tooltip content="View player info">
                                      <span
                                        className="inline-flex"
                                        onClick={(event) => event.stopPropagation()}
                                        onPointerDown={(event) => event.stopPropagation()}
                                      >
                                        <Button
                                          isIconOnly
                                          size="sm"
                                          variant="light"
                                          onPress={() => {
                                            setSelectedPlayerName(player.playerName);
                                            setIsPlayerDetailDrawerOpen(true);
                                          }}
                                        >
                                          <Eye className="h-4 w-4" />
                                        </Button>
                                      </span>
                                    </Tooltip>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </HeroTable>
                  </ScrollShadow>
                </div>
              </CardBody>
              {showReadOnlyInteractionOverlay ? (
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-[inherit] bg-content1/55 backdrop-blur-[1px]">
                  <div className="rounded-medium border border-warning-300/60 bg-content1/92 px-3 py-2 text-center text-xs shadow-md">
                    <p className="inline-flex items-center gap-1 font-semibold text-warning-200">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Reconnecting...
                    </p>
                    <p className="mt-1 text-default-500">Draft actions disabled until sync is restored.</p>
                  </div>
                </div>
              ) : null}
            </Card>

            <Card className="h-full min-h-0 overflow-hidden border border-default-200/40 bg-content1/90 shadow-sm">
              <CardHeader className="flex items-center justify-between gap-2 py-2">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <MessageCircle className="h-4 w-4" />
                  Chat · INSIGHT Fantasy
                </p>
                <Button
                  isIconOnly
                  aria-label={isDesktopChatCollapsed ? "Show chat panel" : "Hide chat panel"}
                  className="h-8 w-8 min-h-8 min-w-8 text-default-500 data-[hover=true]:bg-default-100/80 data-[hover=true]:text-default-700"
                  size="sm"
                  variant="light"
                  onPress={() => setIsDesktopChatCollapsed((prev) => !prev)}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isDesktopChatCollapsed ? "-rotate-90" : "rotate-0"
                    }`}
                  />
                </Button>
              </CardHeader>
              {isDesktopChatCollapsed ? (
                <CardBody className="flex min-h-0 items-center justify-center pt-0">
                  <p className="text-xs text-default-500">Chat is hidden.</p>
                </CardBody>
              ) : (
                <CardBody className="h-full min-h-0 p-1.5 pt-0">
                  <GlobalChatPanel
                    className="h-full"
                    currentUserId={currentUserId}
                    hideOnMobile
                    mode="embedded"
                  />
                </CardBody>
              )}
            </Card>
          </div>
          ) : null}
        </>
      ) : null}

      {isResultsState ? (
        <Card className="border border-success-300/30 bg-content1/80">
          <CardHeader>
            <h2 className="text-lg font-semibold">Draft Recap</h2>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p>
              Draft complete with <span className="font-semibold">{draft.pickCount}</span> picks across{" "}
              <span className="font-semibold">{draft.roundCount}</span> rounds.
            </p>
            <p>
              Your picks: <span className="font-semibold">{userPicks.length}</span> • Remaining queue:{" "}
              <span className="font-semibold">{queuedPlayers.length}</span>
            </p>
          </CardBody>
        </Card>
      ) : null}

      {isLiveState ? (
        <Card className="border border-default-200/35 bg-content1/70">
          <CardBody className="flex flex-wrap items-center justify-between gap-2 py-3">
            <p className="text-xs text-default-500">
              Draft board is collapsed during live draft for performance.
            </p>
            <Button
              size="sm"
              variant="flat"
              onPress={() => setShowExpandedPanels((prev) => !prev)}
            >
              {showExpandedPanels ? "Hide Draft Board" : "Show Draft Board"}
            </Button>
          </CardBody>
        </Card>
      ) : null}

      {!isLiveState || showExpandedPanels ? (
      <>
      <Card className="border border-default-200/40 bg-content1/75">
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <TableProperties className="h-5 w-5 text-primary" />
            3RR Draft Board
          </h2>
          <Chip variant="flat">
            Picks {draft.pickCount}/{draft.totalPickCount}
          </Chip>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="rounded-large border border-default-200/40 bg-content2/35 p-3 sm:p-4">
            <div className="space-y-4">
              {boardRoundNumbers.map((roundNumber) => {
                return (
                  <section
                    key={roundNumber}
                    className={roundNumber === 1 ? "" : "border-t border-default-200/30 pt-4"}
                  >
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">Round {roundNumber}</p>
                      <p className="text-xs text-default-500">
                        {isThreeRoundReversalRound(roundNumber)
                          ? "3RR: high to low slot"
                          : "3RR: low to high slot"}
                      </p>
                    </div>

                    <ScrollShadow className="pb-1" orientation="horizontal">
                      <div className="flex w-full gap-1.5">
                        {participantsByPosition.map((entry) => {
                          const pick = boardPickForSlot({
                            picksByRoundAndParticipantUserId,
                            roundNumber,
                            participantUserId: entry.userId,
                          });
                          const pickImageUrl = pickPlayerImageUrl(pick);
                          const isOnDeck =
                            !pick &&
                            draft.nextPick?.roundNumber === roundNumber &&
                            draft.nextPick.participantUserId === entry.userId;

                          return (
                            <Card
                              key={`${entry.id}-${roundNumber}`}
                              className={`min-w-[6.5rem] flex-1 border ${
                                isOnDeck
                                  ? "border-primary-400/60 bg-primary-500/10"
                                  : "border-default-200/35 bg-content1/65"
                              }`}
                            >
                              <CardBody className="flex aspect-square h-full flex-col justify-between p-1.5">
                                <p className="truncate text-[10px] text-default-500">
                                  #{entry.draftPosition} {entry.displayName}
                                </p>
                                {pick ? (
                                  <>
                                    <div className="space-y-0.5">
                                      <div className="flex min-w-0 items-center gap-1">
                                        {pickImageUrl ? (
                                          <Image
                                            alt={`${pick.playerName} portrait`}
                                            className="h-3 w-3 rounded-full border border-default-300/50 object-cover"
                                            height={12}
                                            src={pickImageUrl}
                                            width={12}
                                          />
                                        ) : pick.teamIconUrl ? (
                                          <CroppedTeamLogo
                                            alt={`${pick.playerName} team logo`}
                                            frameClassName="h-3 w-3.5"
                                            height={12}
                                            imageClassName="h-3"
                                            src={pick.teamIconUrl}
                                            width={14}
                                          />
                                        ) : (
                                          <span className="h-3 w-3.5 shrink-0" />
                                        )}
                                        <p className="truncate text-[11px] font-semibold">{pick.playerName}</p>
                                      </div>
                                      <p className="truncate text-[10px] text-default-500">
                                        R{pick.roundNumber} P{pick.roundPick}
                                      </p>
                                    </div>
                                    <div>
                                      {pick.playerRole ? (
                                        <Chip
                                          className={`${roleChipClassName(pick.playerRole)} text-[10px]`}
                                          color="default"
                                          size="sm"
                                          variant="flat"
                                        >
                                          {formatRoleLabel(pick.playerRole)}
                                        </Chip>
                                      ) : null}
                                    </div>
                                  </>
                                ) : (
                                  <p
                                    className={`text-[10px] ${
                                      isOnDeck
                                        ? "font-medium text-primary-600 dark:text-primary-300"
                                        : "text-default-500"
                                    }`}
                                  >
                                    {isOnDeck ? "On deck" : "Open"}
                                  </p>
                                )}
                              </CardBody>
                            </Card>
                          );
                        })}
                      </div>
                    </ScrollShadow>
                  </section>
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>
      </>
      ) : null}

      {isLiveState && isCurrentUserParticipant && isMobileViewport && !selectedPlayer && !isMobileQueueSheetOpen ? (
        <div className="fixed inset-x-3 z-40" style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="rounded-large border border-primary-300/35 bg-content1/95 p-2 shadow-lg backdrop-blur">
            {canCurrentUserPick && autopickPreviewLine ? (
              <p
                className={`mb-2 rounded-medium border px-2 py-1 text-[11px] ${
                  isLowTimerWarning
                    ? "animate-pulse border-warning-300/60 bg-warning-500/14 text-warning-200"
                    : "border-primary-300/35 bg-primary-500/10 text-primary-200"
                }`}
              >
                {autopickPreviewLine}
              </p>
            ) : null}
            {hasPendingManualConfirm && pendingManualDraftPlayer ? (
              <p className="mb-2 text-[11px] text-default-500">
                Confirming {pendingManualDraftPlayer.playerName} ({formatRoleLabel(pendingManualDraftPlayer.playerRole)})
                {pendingManualSlotImpact ? ` • Fills ${pendingManualSlotImpact.fills}` : ""}
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
              {hasPendingManualConfirm ? (
                <>
                  <Button
                    className={isLowTimerWarning ? "animate-pulse" : ""}
                    color="primary"
                    isDisabled={!pendingManualDraftPlayerName || !canDraftActions}
                    isLoading={pickPending}
                    onPress={() => {
                      if (!pendingManualDraftPlayerName) {
                        return;
                      }
                      void submitPick(pendingManualDraftPlayerName, { source: "manual" });
                    }}
                  >
                    {pendingManualDraftPlayerName
                      ? `Confirm: ${pendingManualDraftPlayerName}`
                      : "Confirm draft"}
                  </Button>
                  <Button variant="flat" onPress={() => setPendingManualDraftPlayerName(null)}>
                    Cancel
                  </Button>
                  <Button variant="light" onPress={() => setMobileLiveTab("team")}>
                    My Team
                  </Button>
                </>
              ) : canCurrentUserPick ? (
                <>
                  <Button
                    className={isLowTimerWarning ? "animate-pulse" : ""}
                    color="primary"
                    isDisabled={!draftActionPlayerName || !canDraftActions}
                    isLoading={pickPending}
                    onPress={() => requestManualDraft()}
                  >
                    {draftActionPlayerName ? `Draft now: ${draftActionPlayerName}` : "Select a player"}
                  </Button>
                  <Button variant="flat" onPress={() => setMobileLiveTab("queue")}>
                    Queue ({queuedPlayers.length})
                  </Button>
                  <Button variant="light" onPress={() => setMobileLiveTab("team")}>
                    My Team
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    color="primary"
                    onPress={() => setMobileLiveTab("players")}
                  >
                    Browse players
                  </Button>
                  <Button variant="flat" onPress={() => setMobileLiveTab("queue")}>
                    Queue ({queuedPlayers.length})
                  </Button>
                  <Button variant="light" onPress={() => setMobileLiveTab("team")}>
                    My Team
                  </Button>
                </>
              )}
            </div>
            {isRealtimeReadOnly ? (
              <p className="mt-1 text-[11px] text-warning-300">
                Read-only while reconnecting. Last synced {secondsSinceLastSync}s ago.
              </p>
            ) : null}
            {showQueueEmptyAutopickWarning && canCurrentUserPick ? (
              <p className="mt-1 text-[11px] text-warning-300">
                {queueAutopickWarningMessage}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {isLiveState && selectedPlayer && isMobileViewport ? (
        <div
          className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-default-200/35 bg-content1/97 p-3 shadow-2xl"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          onTouchEnd={(event) => {
            const startY = mobilePlayerSheetTouchStartYRef.current;
            const endY = event.changedTouches[0]?.clientY ?? null;
            mobilePlayerSheetTouchStartYRef.current = null;
            if (startY === null || endY === null) {
              return;
            }
            if (endY - startY > 72) {
              setSelectedPlayerName(null);
            }
          }}
          onTouchStart={(event) => {
            mobilePlayerSheetTouchStartYRef.current = event.touches[0]?.clientY ?? null;
          }}
        >
          <ScrollShadow
            className="mx-auto max-h-[68svh] max-w-xl space-y-2 pr-1"
            orientation="vertical"
          >
            <div className="mx-auto h-1.5 w-12 rounded-full bg-default-300/50" />
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{selectedPlayer.playerName}</p>
                <p className="truncate text-sm text-default-500">
                  {selectedPlayer.playerTeam ?? "—"} • {formatRoleLabel(selectedPlayer.playerRole)}
                </p>
              </div>
              <Button isIconOnly size="sm" variant="light" onPress={() => setSelectedPlayerName(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-default-500">
              OVR: {selectedPlayer.analytics?.overallRank ? `#${selectedPlayer.analytics.overallRank}` : "Unranked"} •
              POS: {selectedPlayer.analytics?.positionRank ? `#${selectedPlayer.analytics.positionRank}` : "Unranked"}
            </p>
            <p className="text-xs text-default-500">
              Avg points/game:{" "}
              {selectedPlayer.analytics?.averageFantasyPoints?.toFixed(2) ?? "N/A"} • Games:{" "}
              {selectedPlayer.analytics?.gamesPlayed ?? 0}
            </p>
            {selectedPlayer.analytics?.topChampions.length ? (
              <div className="rounded-medium border border-default-200/35 bg-content2/35 px-2 py-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-default-500">
                  Top champs
                </p>
                <ul className="mt-1 space-y-1">
                  {selectedPlayer.analytics.topChampions.map((entry, index) => {
                    const championIconCandidateUrl =
                      entry.championIconUrl ?? championDataDragonIconUrl(entry.champion);
                    const championIconUrl =
                      championIconCandidateUrl &&
                      !brokenChampionIconUrls.has(championIconCandidateUrl)
                        ? championIconCandidateUrl
                        : null;
                    const spriteStyle = championSpriteStyle(entry, 24);
                    return (
                      <li
                        key={`${selectedPlayer.playerName}-mobile-champ-${entry.champion}-${index}`}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-medium border border-default-200/60 bg-content3">
                          {championIconUrl ? (
                            <Image
                              alt={`${entry.champion} icon`}
                              className="h-full w-full object-cover"
                              height={24}
                              onError={() => markChampionIconUrlBroken(championIconUrl)}
                              src={championIconUrl}
                              unoptimized={isDataDragonChampionIconUrl(championIconUrl)}
                              width={24}
                            />
                          ) : spriteStyle ? (
                            <span
                              aria-hidden
                              className="block h-full w-full"
                              style={spriteStyle}
                            />
                          ) : (
                            <span className="text-[9px] font-semibold uppercase text-default-600">
                              {championInitials(entry.champion)}
                            </span>
                          )}
                        </span>
                        <span className="min-w-0 text-default-500">
                          <span className="font-medium text-default-700 dark:text-default-200">
                            {entry.champion}
                          </span>{" "}
                          {formatChampionTendencyStats(entry)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <p className="text-[11px] text-default-500">Swipe down to close</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                color={isSelectedPlayerQueued ? "primary" : "default"}
                isDisabled={isSelectedPlayerQueued || !canQueueActions}
                variant="flat"
                onPress={() => addPlayerToQueue(selectedPlayer.playerName)}
              >
                {isSelectedPlayerQueued ? "Queued" : "Add to queue"}
              </Button>
              <Button
                color="primary"
                isDisabled={!canDraftActions}
                variant="flat"
                onPress={() => requestManualDraft(selectedPlayer.playerName)}
              >
                Draft
              </Button>
            </div>
          </ScrollShadow>
        </div>
      ) : null}

      {isLiveState && isMobileViewport && isMobileQueueSheetOpen ? (
        <div
          className="fixed inset-0 z-50 bg-black/55"
          onClick={() => setIsMobileQueueSheetOpen(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 max-h-[82svh] overflow-hidden rounded-t-large border-t border-default-200/40 bg-content1 p-3 shadow-xl"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto flex max-h-[82svh] max-w-xl flex-col gap-3 overflow-hidden">
              <div className="mx-auto h-1.5 w-12 rounded-full bg-default-300/50" />
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold">Queue ({queuedPlayers.length})</h3>
                <Button isIconOnly size="sm" variant="light" onPress={() => setIsMobileQueueSheetOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  color={settings.autoPickFromQueue ? "primary" : "default"}
                  isDisabled={isRealtimeReadOnly}
                  size="sm"
                  variant="flat"
                  onPress={() => toggleAutopickSetting("mobile-queue-sheet")}
                >
                  Autopick {settings.autoPickFromQueue ? "On" : "Off"}
                </Button>
                <Button
                  isDisabled={pickQueue.length === 0 || !canQueueActions}
                  size="sm"
                  variant="light"
                  onPress={clearQueue}
                >
                  Clear
                </Button>
              </div>
              {queueAutopickTargetLine ? (
                <p className="text-xs text-default-500">{queueAutopickTargetLine}</p>
              ) : null}
              {autopickCountdownSeconds !== null ? (
                <p className="text-xs text-warning-300">
                  {`Autopick in ${autopickCountdownSeconds}s: ${autopickTargetLabel}`}
                </p>
              ) : null}
              {showQueueEmptyAutopickWarning ? (
                <p className="text-xs text-warning-300">
                  {queueAutopickWarningMessage}
                </p>
              ) : null}
              {isRealtimeReadOnly ? (
                <p className="text-xs text-warning-300">
                  Realtime reconnecting. Queue edits are read-only.
                </p>
              ) : null}
              {canCurrentUserPick && queuedPlayers.length === 0 ? (
                <p className="text-xs text-default-500">Queue your top 3 so autopick is safe.</p>
              ) : null}
              <ScrollShadow
                className="min-h-0 flex-1 rounded-large border border-default-200/35 bg-content2/35"
                orientation="vertical"
              >
                {queuedPlayers.length === 0 ? (
                  <p className="p-3 text-sm text-default-500">Queue is empty.</p>
                ) : (
                  <ul className="divide-y divide-default-200/30">
                    {queuedPlayers.map((player, index) => (
                      <li
                        key={player.playerName}
                        className={`flex items-center gap-2 px-3 py-2 ${index === 0 ? "bg-primary-500/10" : ""}`}
                        draggable={canQueueActions}
                        onDragEnd={() => setDraggedQueueIndex(null)}
                        onDragOver={(event) => {
                          if (!canQueueActions) {
                            return;
                          }
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }}
                        onDragStart={() => {
                          if (!canQueueActions) {
                            return;
                          }
                          setDraggedQueueIndex(index);
                        }}
                        onDrop={() => {
                          if (!canQueueActions || draggedQueueIndex === null) {
                            return;
                          }
                          moveQueueItem(draggedQueueIndex, index);
                          setDraggedQueueIndex(null);
                        }}
                      >
                        <span className="text-xs font-semibold text-default-500">{index + 1}</span>
                        <GripVertical className="h-4 w-4 shrink-0 text-default-400" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{player.playerName}</p>
                          <p className="truncate text-xs text-default-500">
                            {[player.playerTeam, formatRoleLabel(player.playerRole)].filter(Boolean).join(" • ")}
                          </p>
                        </div>
                        <Button
                          isIconOnly
                          isDisabled={!canQueueActions}
                          size="sm"
                          variant="light"
                          onPress={() => removePlayerFromQueue(player.playerName)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollShadow>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="mt-8 border-t border-default-200/28 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] text-[#d8e0ee]">
          <div className="min-w-0">
            <p className="truncate font-semibold uppercase tracking-[0.14em] text-[#f5f8ff]">
              INSIGHT GAMING FANTASY LEAGUE
            </p>
            <p className="mt-1 text-[#d2dced]">© {currentYear} Insight Gaming Fantasy League. All rights reserved.</p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#dce4f2] md:justify-end">
            <span className="mono-points text-[11px] text-[#e4ebf8]">Updated: {footerUpdatedLabel}</span>
            <span className="hidden text-[#a9b4c9] md:inline">•</span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[#e4ebf8]">
              Source:
              <Link
                href={footerSourceLink}
                target="_blank"
                rel="noreferrer"
                underline="hover"
                className="max-w-[280px] truncate text-[11px] text-[#f2f6ff] data-[hover=true]:text-[#f0d58e]"
              >
                {draft.sourcePage}
              </Link>
            </span>
          </div>
        </div>
      </footer>
    </section>
  );
};
