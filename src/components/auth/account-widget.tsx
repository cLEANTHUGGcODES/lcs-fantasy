"use client";

import { Button } from "@heroui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@heroui/drawer";
import { Input } from "@heroui/input";
import { Tooltip } from "@heroui/tooltip";
import { Check, Settings, Trash2, TriangleAlert, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChangeEvent, CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { ScoringSettingsModal } from "@/components/auth/scoring-settings-modal";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { PROFILE_IMAGES_BUCKET, getPublicStorageUrl } from "@/lib/supabase-storage";
import { normalizePersonName, normalizeTeamName } from "@/lib/user-profile";
import type { FantasyScoring } from "@/types/fantasy";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const AVATAR_RING_SWATCHES = [
  { color: "#c79b3b", label: "Gold" },
  { color: "#f5c26b", label: "Sun" },
  { color: "#e2e8f0", label: "Silver" },
  { color: "#6ee7b7", label: "Mint" },
  { color: "#38bdf8", label: "Cyan" },
  { color: "#818cf8", label: "Indigo" },
  { color: "#f472b6", label: "Pink" },
  { color: "#fb7185", label: "Rose" },
  { color: "#f97316", label: "Orange" },
  { color: "#22c55e", label: "Green" },
] as const;
const DEFAULT_AVATAR_RING_COLOR = "#c79b3b";

type AccountWidgetLayout = "card" | "navbar";
type ProfileField = "firstName" | "lastName" | "teamName";
type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

const initialsForName = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

const extensionForFile = (file: File): string => {
  const nameParts = file.name.split(".");
  const fromName = nameParts.length > 1 ? nameParts[nameParts.length - 1]?.trim() : "";
  if (fromName) {
    return fromName.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  if (file.type === "image/png") {
    return "png";
  }
  if (file.type === "image/webp") {
    return "webp";
  }
  return "jpg";
};

const validateImageFile = (file: File): string | null => {
  if (!SUPPORTED_MIME_TYPES.has(file.type)) {
    return "Use a JPG, PNG, or WEBP image.";
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return "Image must be 3MB or smaller.";
  }
  return null;
};

const formatDisplayLabel = (firstName: string, lastName: string): string => {
  const initial = lastName[0]?.toUpperCase();
  return initial ? `${firstName} ${initial}.` : firstName;
};

export const AccountWidget = ({
  userLabel,
  firstName,
  lastName,
  teamName,
  avatarPath,
  avatarBorderColor,
  avatarUrl,
  canAccessSettings,
  initialScoring,
  layout = "card",
}: {
  userLabel: string;
  firstName: string | null;
  lastName: string | null;
  teamName: string | null;
  avatarPath: string | null;
  avatarBorderColor: string | null;
  avatarUrl: string | null;
  canAccessSettings: boolean;
  initialScoring: FantasyScoring;
  layout?: AccountWidgetLayout;
}) => {
  const router = useRouter();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const customColorInputRef = useRef<HTMLInputElement | null>(null);
  const saveSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [isScoringSettingsOpen, setIsScoringSettingsOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ProfileFieldErrors>({});
  const [activeLabel, setActiveLabel] = useState(userLabel);
  const [activeFirstName, setActiveFirstName] = useState(firstName);
  const [activeLastName, setActiveLastName] = useState(lastName);
  const [activeTeamName, setActiveTeamName] = useState(teamName);
  const [activeAvatarPath, setActiveAvatarPath] = useState(avatarPath);
  const [activeAvatarBorderColor, setActiveAvatarBorderColor] = useState(avatarBorderColor);
  const [activeAvatarUrl, setActiveAvatarUrl] = useState(avatarUrl);
  const [draftFirstName, setDraftFirstName] = useState(firstName ?? "");
  const [draftLastName, setDraftLastName] = useState(lastName ?? "");
  const [draftTeamName, setDraftTeamName] = useState(teamName ?? "");
  const [draftAvatarPath, setDraftAvatarPath] = useState(avatarPath);
  const [draftAvatarUrl, setDraftAvatarUrl] = useState(avatarUrl);
  const [draftAvatarBorderColor, setDraftAvatarBorderColor] = useState(avatarBorderColor);
  const resolvedDraftAvatarRingColor = draftAvatarBorderColor ?? DEFAULT_AVATAR_RING_COLOR;

  const activeAvatarBorderStyle: CSSProperties | undefined = activeAvatarBorderColor
    ? { outlineColor: activeAvatarBorderColor }
    : undefined;
  const draftAvatarBorderStyle: CSSProperties = { outlineColor: resolvedDraftAvatarRingColor };

  const normalizedActiveFirstName = normalizePersonName(activeFirstName ?? "");
  const normalizedActiveLastName = normalizePersonName(activeLastName ?? "");
  const normalizedActiveTeamName = normalizeTeamName(activeTeamName ?? "");
  const normalizedDraftFirstName = normalizePersonName(draftFirstName);
  const normalizedDraftLastName = normalizePersonName(draftLastName);
  const normalizedDraftTeamName = normalizeTeamName(draftTeamName);
  const isFirstNameLocked = normalizedActiveFirstName.length > 0;
  const isLastNameLocked = normalizedActiveLastName.length > 0;
  const hasPresetRingColor = AVATAR_RING_SWATCHES.some(
    ({ color }) => color === draftAvatarBorderColor,
  );
  const isDefaultRingColorSelected = draftAvatarBorderColor === null;
  const isCustomRingColorSelected = Boolean(draftAvatarBorderColor) && !hasPresetRingColor;
  const teamPreviewSource = (normalizedDraftTeamName || "Team Name").toUpperCase();
  const isTeamPreviewTruncated = teamPreviewSource.length > 18;
  const teamPreviewText = useMemo(() => {
    const value = teamPreviewSource;
    if (value.length <= 18) {
      return value;
    }
    return `${value.slice(0, 17)}…`;
  }, [teamPreviewSource]);

  const hasUnsavedChanges = useMemo(
    () =>
      normalizedDraftFirstName !== normalizedActiveFirstName ||
      normalizedDraftLastName !== normalizedActiveLastName ||
      normalizedDraftTeamName !== normalizedActiveTeamName ||
      draftAvatarPath !== activeAvatarPath ||
      draftAvatarBorderColor !== activeAvatarBorderColor,
    [
      activeAvatarBorderColor,
      activeAvatarPath,
      draftAvatarBorderColor,
      draftAvatarPath,
      normalizedActiveFirstName,
      normalizedActiveLastName,
      normalizedActiveTeamName,
      normalizedDraftFirstName,
      normalizedDraftLastName,
      normalizedDraftTeamName,
    ],
  );

  const headerSubtitle = useMemo(() => {
    const fullName = [activeFirstName, activeLastName]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .trim() || activeLabel;
    if (!activeTeamName) {
      return fullName;
    }
    return `${fullName} • ${activeTeamName.toUpperCase()}`;
  }, [activeFirstName, activeLastName, activeLabel, activeTeamName]);

  useEffect(
    () => () => {
      if (saveSuccessTimeoutRef.current) {
        clearTimeout(saveSuccessTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const html = document.documentElement;
    const body = document.body;
    const previous = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlOverscrollBehaviorY: html.style.overscrollBehaviorY,
      bodyOverscrollBehaviorY: body.style.overscrollBehaviorY,
    };

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";

    return () => {
      html.style.overflow = previous.htmlOverflow;
      body.style.overflow = previous.bodyOverflow;
      html.style.overscrollBehaviorY = previous.htmlOverscrollBehaviorY;
      body.style.overscrollBehaviorY = previous.bodyOverscrollBehaviorY;
    };
  }, [isOpen]);

  const validateField = (field: ProfileField): string | null => {
    if (field === "firstName") {
      if (isFirstNameLocked && normalizedDraftFirstName !== normalizedActiveFirstName) {
        return "First name cannot be changed once set.";
      }
      if (!normalizedDraftFirstName) {
        return "First name is required.";
      }
      return null;
    }
    if (field === "lastName") {
      if (isLastNameLocked && normalizedDraftLastName !== normalizedActiveLastName) {
        return "Last name cannot be changed once set.";
      }
      if (!normalizedDraftLastName) {
        return "Last name is required.";
      }
      return null;
    }
    if (!normalizedDraftTeamName) {
      return "Team name is required.";
    }
    return null;
  };

  const validateAllFields = (): boolean => {
    const nextErrors: ProfileFieldErrors = {
      firstName: validateField("firstName") ?? undefined,
      lastName: validateField("lastName") ?? undefined,
      teamName: validateField("teamName") ?? undefined,
    };
    setFieldErrors(nextErrors);
    return !nextErrors.firstName && !nextErrors.lastName && !nextErrors.teamName;
  };

  const cleanupUnsavedAvatarDraft = async () => {
    if (!draftAvatarPath || draftAvatarPath === activeAvatarPath) {
      return;
    }
    const supabase = getSupabaseBrowserClient();
    await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([draftAvatarPath]);
  };

  const resetDraftFromActive = () => {
    setDraftFirstName(activeFirstName ?? "");
    setDraftLastName(activeLastName ?? "");
    setDraftTeamName(activeTeamName ?? "");
    setDraftAvatarPath(activeAvatarPath);
    setDraftAvatarUrl(activeAvatarUrl);
    setDraftAvatarBorderColor(activeAvatarBorderColor);
    setFieldErrors({});
    setSaveError(null);
    setSaveSuccess(null);
    setAvatarMessage(null);
  };

  const openProfileModal = () => {
    resetDraftFromActive();
    setDeleteError(null);
    setIsOpen(true);
    setIsSettingsDrawerOpen(false);
    setIsScoringSettingsOpen(false);
  };

  const closeProfileModal = async () => {
    if (savePending || avatarPending || deletePending) {
      return;
    }

    if (hasUnsavedChanges) {
      const shouldDiscard = window.confirm("Discard unsaved profile changes?");
      if (!shouldDiscard) {
        return;
      }
      await cleanupUnsavedAvatarDraft();
    }

    setIsOpen(false);
    resetDraftFromActive();
    setDeleteError(null);
  };

  const handleAvatarFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file || avatarPending) {
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    setAvatarMessage(null);

    const validationError = validateImageFile(file);
    if (validationError) {
      setSaveError(validationError);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSaveError(userError?.message ?? "Unable to load current user.");
      return;
    }

    const ext = extensionForFile(file);
    const nextPath = `${user.id}/avatar-${Date.now()}.${ext}`;

    setAvatarPending(true);
    const { error: uploadError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(nextPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      setAvatarPending(false);
      setSaveError(uploadError.message);
      return;
    }

    if (draftAvatarPath && draftAvatarPath !== activeAvatarPath && draftAvatarPath !== nextPath) {
      await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([draftAvatarPath]);
    }

    const { supabaseUrl } = getSupabaseAuthEnv();
    setDraftAvatarPath(nextPath);
    setDraftAvatarUrl(
      getPublicStorageUrl({
        supabaseUrl,
        bucket: PROFILE_IMAGES_BUCKET,
        path: nextPath,
      }),
    );
    setAvatarMessage("Image selected. Save changes to apply.");
    setAvatarPending(false);
  };

  const handleRemoveDraftAvatar = async () => {
    if (!draftAvatarPath || avatarPending) {
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    setAvatarMessage(null);
    setAvatarPending(true);
    const supabase = getSupabaseBrowserClient();

    if (draftAvatarPath !== activeAvatarPath) {
      await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([draftAvatarPath]);
    }

    setDraftAvatarPath(null);
    setDraftAvatarUrl(null);
    setAvatarMessage(activeAvatarPath ? "Avatar will be removed when you save changes." : "Avatar removed.");
    setAvatarPending(false);
  };

  const handleSaveProfile = async () => {
    if (savePending || avatarPending || !hasUnsavedChanges) {
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    if (!validateAllFields()) {
      return;
    }

    const firstNameToSave = isFirstNameLocked ? normalizedActiveFirstName : normalizedDraftFirstName;
    const lastNameToSave = isLastNameLocked ? normalizedActiveLastName : normalizedDraftLastName;

    setSavePending(true);
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setSavePending(false);
      setSaveError(userError?.message ?? "Unable to load current user.");
      return;
    }

    const metadata = user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};

    const { error: updateError } = await supabase.auth.updateUser({
      data: {
        ...metadata,
        first_name: firstNameToSave,
        last_name: lastNameToSave,
        team_name: normalizedDraftTeamName,
        display_name: `${firstNameToSave} ${lastNameToSave}`,
        full_name: `${firstNameToSave} ${lastNameToSave}`,
        avatar_path: draftAvatarPath,
        avatar_border_color: draftAvatarBorderColor,
      },
    });

    if (updateError) {
      setSavePending(false);
      setSaveError(updateError.message);
      return;
    }

    if (activeAvatarPath && activeAvatarPath !== draftAvatarPath) {
      await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([activeAvatarPath]);
    }

    setActiveFirstName(firstNameToSave);
    setActiveLastName(lastNameToSave);
    setActiveTeamName(normalizedDraftTeamName);
    setActiveAvatarPath(draftAvatarPath);
    setActiveAvatarUrl(draftAvatarUrl);
    setActiveAvatarBorderColor(draftAvatarBorderColor);
    setActiveLabel(formatDisplayLabel(firstNameToSave, lastNameToSave));
    setDraftFirstName(firstNameToSave);
    setDraftLastName(lastNameToSave);
    setDraftTeamName(normalizedDraftTeamName);
    setDraftAvatarPath(draftAvatarPath);
    setDraftAvatarUrl(draftAvatarUrl);
    setDraftAvatarBorderColor(draftAvatarBorderColor);
    setSavePending(false);
    setFieldErrors({});
    setAvatarMessage(null);
    setSaveSuccess("Saved \u2713");
    if (saveSuccessTimeoutRef.current) {
      clearTimeout(saveSuccessTimeoutRef.current);
    }
    saveSuccessTimeoutRef.current = setTimeout(() => {
      setSaveSuccess(null);
    }, 1800);
    router.refresh();
  };

  const handleDeleteAccount = async () => {
    if (deletePending) {
      return;
    }

    const accepted = window.confirm(
      "Delete your account permanently? This removes your profile and cannot be undone.",
    );
    if (!accepted) {
      return;
    }

    const confirmation = window.prompt("Type DELETE to confirm account removal.");
    if (confirmation !== "DELETE") {
      setDeleteError("Deletion cancelled. Type DELETE exactly to confirm.");
      return;
    }

    setDeletePending(true);
    setDeleteError(null);

    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ confirmation }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to delete account.");
      }

      const supabase = getSupabaseBrowserClient();
      await supabase.auth.signOut().catch(() => undefined);
      setIsOpen(false);
      setIsSettingsDrawerOpen(false);
      setIsScoringSettingsOpen(false);
      router.replace("/auth");
      router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Unable to delete account.");
    } finally {
      setDeletePending(false);
    }
  };

  const avatarNode = activeAvatarUrl ? (
    <span
      className={`relative inline-flex overflow-hidden rounded-full bg-default-200/30 outline outline-2 outline-default-300/40 ${
        layout === "navbar" ? "h-11 w-11 sm:h-9 sm:w-9" : "h-14 w-14"
      }`}
      style={activeAvatarBorderStyle}
    >
      <Image
        src={activeAvatarUrl}
        alt={`${activeLabel} profile image`}
        fill
        sizes={layout === "navbar" ? "(max-width: 639px) 44px, 36px" : "56px"}
        quality={100}
        unoptimized
        className="object-cover object-center"
      />
    </span>
  ) : (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-default-200/40 font-semibold text-default-600 outline outline-2 outline-default-300/40 ${
        layout === "navbar" ? "h-11 w-11 text-xs sm:h-9 sm:w-9" : "h-14 w-14 text-sm"
      }`}
      style={activeAvatarBorderStyle}
    >
      {initialsForName(activeLabel)}
    </span>
  );

  const profileModal = isOpen ? (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 px-4 py-5 backdrop-blur-[2px] sm:items-center sm:py-6"
      onClick={() => {
        void closeProfileModal();
      }}
    >
      <div
        className="flex w-full max-w-4xl max-h-[calc(100dvh-2.5rem)] flex-col overflow-hidden rounded-[20px] border border-default-200/40 bg-content1 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-default-200/30 bg-content2/10 px-5 py-4 md:px-6">
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-white">Profile Settings</p>
            <p className="truncate text-sm font-medium text-white/85">{headerSubtitle}</p>
          </div>
          <Button
            isIconOnly
            aria-label="Close profile settings"
            className="h-10 w-10 min-h-0 min-w-0 text-default-200"
            size="sm"
            variant="flat"
            onPress={() => {
              void closeProfileModal();
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 md:px-6 md:py-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-[360px_1fr]">
            <section className="rounded-large border border-default-200/30 bg-content2/20 p-5">
              <div className="flex justify-center">
                {draftAvatarUrl ? (
                  <span
                    className="relative inline-flex h-28 w-28 overflow-hidden rounded-full bg-default-200/30 outline outline-2 outline-offset-0 outline-default-300/40 shadow-[inset_0_1px_2px_rgba(255,255,255,0.15)]"
                    style={draftAvatarBorderStyle}
                  >
                    <Image
                      src={draftAvatarUrl}
                      alt={`${activeLabel} profile image`}
                      fill
                      sizes="112px"
                      quality={100}
                      unoptimized
                      className="object-cover object-center"
                    />
                  </span>
                ) : (
                  <span
                    className="inline-flex h-28 w-28 items-center justify-center rounded-full bg-default-200/40 text-xl font-semibold text-default-600 outline outline-2 outline-default-300/40 shadow-[inset_0_1px_2px_rgba(255,255,255,0.15)]"
                    style={draftAvatarBorderStyle}
                  >
                    {initialsForName(activeLabel)}
                  </span>
                )}
              </div>

              <input
                ref={avatarInputRef}
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                type="file"
                onChange={handleAvatarFileChange}
              />
              <input
                ref={customColorInputRef}
                className="hidden"
                type="color"
                value={draftAvatarBorderColor ?? DEFAULT_AVATAR_RING_COLOR}
                onChange={(event) => {
                  setDraftAvatarBorderColor(event.target.value.toLowerCase());
                  setSaveError(null);
                  setSaveSuccess(null);
                }}
              />

              <div className="mt-3 flex w-full flex-wrap items-center justify-center gap-2">
                <Button
                  className="min-w-[126px]"
                  color="primary"
                  isLoading={avatarPending}
                  size="sm"
                  variant="flat"
                  onPress={() => avatarInputRef.current?.click()}
                >
                  Upload image
                </Button>
                <Button
                  isDisabled={!draftAvatarPath || avatarPending}
                  className={`${
                    draftAvatarPath
                      ? "h-9 w-9 min-h-0 min-w-0 bg-danger-500/10 text-danger-200 data-[hover=true]:bg-danger-500/20 data-[hover=true]:text-danger-100"
                      : "h-9 w-9 min-h-0 min-w-0 cursor-not-allowed text-default-500"
                  }`}
                  aria-label="Remove image"
                  color={draftAvatarPath ? "danger" : "default"}
                  isIconOnly
                  size="sm"
                  variant="light"
                  onPress={handleRemoveDraftAvatar}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-center text-[11px] text-default-400">
                PNG/JPG/WEBP • up to 3MB • recommended 512x512
              </p>
              {!draftAvatarPath ? <p className="mt-1 text-[11px] text-default-500">Using default image</p> : null}

              <div className="mt-5">
                <p className="text-[11px] font-medium uppercase tracking-wide text-default-500">Avatar Ring</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {AVATAR_RING_SWATCHES.map(({ color, label }) => {
                    const isSelected = draftAvatarBorderColor === color;
                    return (
                      <Tooltip key={color} content={label}>
                        <button
                          aria-label={`Use ${label} avatar ring color`}
                          className={`relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
                            isSelected
                              ? "border-default-100 ring-2 ring-default-50/80 ring-offset-1 ring-offset-content1 shadow-[0_0_0_1px_rgba(255,255,255,0.35)]"
                              : "border-default-300/40"
                          }`}
                          type="button"
                          onClick={() => {
                            setDraftAvatarBorderColor(color);
                            setSaveError(null);
                            setSaveSuccess(null);
                          }}
                        >
                          <span className="h-5 w-5 rounded-full" style={{ backgroundColor: color }} />
                          {isSelected ? (
                            <span className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/70 bg-black/85 text-white shadow-sm">
                              <Check className="h-3 w-3" />
                            </span>
                          ) : null}
                        </button>
                      </Tooltip>
                    );
                  })}
                  <Button
                    className="text-xs"
                    size="sm"
                    variant={isCustomRingColorSelected ? "solid" : "flat"}
                    onPress={() => {
                      customColorInputRef.current?.click();
                      setSaveSuccess(null);
                    }}
                  >
                    {isCustomRingColorSelected ? <Check className="mr-1 h-3 w-3" /> : null}
                    Custom...
                  </Button>
                  <Button
                    className="text-xs"
                    color={isDefaultRingColorSelected ? "primary" : "default"}
                    size="sm"
                    variant="flat"
                    onPress={() => {
                      setDraftAvatarBorderColor(null);
                      setSaveSuccess(null);
                    }}
                  >
                    {isDefaultRingColorSelected ? <Check className="mr-1 h-3 w-3" /> : null}
                    Default
                  </Button>
                </div>
              </div>
              {avatarMessage ? <p className="mt-3 text-xs text-success-400">{avatarMessage}</p> : null}
            </section>

            <section
              className="rounded-large border border-default-200/30 bg-content2/20 p-5 pt-3"
              onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                const target = event.target as HTMLElement | null;
                if (event.key !== "Enter" || event.shiftKey || !target) {
                  return;
                }
                if (target.tagName !== "INPUT") {
                  return;
                }
                event.preventDefault();
                void handleSaveProfile();
              }}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-default-500">Profile Details</p>
              <p className="mt-1 text-xs text-default-400">Update your personal and team profile details.</p>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  autoComplete="given-name"
                  classNames={{
                    inputWrapper:
                      "min-h-12 h-12 border border-default-200/55 bg-content1/70 data-[focus=true]:border-primary-400 data-[focus=true]:ring-2 data-[focus=true]:ring-primary-400/35",
                  }}
                  errorMessage={fieldErrors.firstName}
                  isDisabled={isFirstNameLocked}
                  isInvalid={Boolean(fieldErrors.firstName)}
                  label={<span>First name <span className="text-danger-400/70">*</span></span>}
                  labelPlacement="outside"
                  placeholder="First name"
                  value={draftFirstName}
                  onBlur={() =>
                    setFieldErrors((previous) => ({
                      ...previous,
                      firstName: validateField("firstName") ?? undefined,
                    }))}
                  onValueChange={(value) => {
                    setDraftFirstName(value);
                    setFieldErrors((previous) => ({ ...previous, firstName: undefined }));
                    setSaveError(null);
                    setSaveSuccess(null);
                  }}
                />
                <Input
                  autoComplete="family-name"
                  classNames={{
                    inputWrapper:
                      "min-h-12 h-12 border border-default-200/55 bg-content1/70 data-[focus=true]:border-primary-400 data-[focus=true]:ring-2 data-[focus=true]:ring-primary-400/35",
                  }}
                  errorMessage={fieldErrors.lastName}
                  isDisabled={isLastNameLocked}
                  isInvalid={Boolean(fieldErrors.lastName)}
                  label={<span>Last name <span className="text-danger-400/70">*</span></span>}
                  labelPlacement="outside"
                  placeholder="Last name"
                  value={draftLastName}
                  onBlur={() =>
                    setFieldErrors((previous) => ({
                      ...previous,
                      lastName: validateField("lastName") ?? undefined,
                    }))}
                  onValueChange={(value) => {
                    setDraftLastName(value);
                    setFieldErrors((previous) => ({ ...previous, lastName: undefined }));
                    setSaveError(null);
                    setSaveSuccess(null);
                  }}
                />
              </div>

              <div className="mt-4">
                <Input
                  autoComplete="organization"
                  classNames={{
                    inputWrapper:
                      "min-h-12 h-12 border border-default-200/55 bg-content1/70 data-[focus=true]:border-primary-400 data-[focus=true]:ring-2 data-[focus=true]:ring-primary-400/35",
                  }}
                  description="Shown on matchup cards and leaderboards."
                  errorMessage={fieldErrors.teamName}
                  isInvalid={Boolean(fieldErrors.teamName)}
                  label={<span>Team name <span className="text-danger-400/70">*</span></span>}
                  labelPlacement="outside"
                  placeholder="Team name"
                  value={draftTeamName}
                  onBlur={() =>
                    setFieldErrors((previous) => ({
                      ...previous,
                      teamName: validateField("teamName") ?? undefined,
                    }))}
                  onValueChange={(value) => {
                    setDraftTeamName(value);
                    setFieldErrors((previous) => ({ ...previous, teamName: undefined }));
                    setSaveError(null);
                    setSaveSuccess(null);
                  }}
                />
                <p className="mt-2 text-xs text-default-500">
                  Auto-uppercase preview:{" "}
                  <span className="font-medium text-default-300">{teamPreviewText}</span>
                  {isTeamPreviewTruncated ? (
                    <span className="ml-1 text-default-500/90">• truncated</span>
                  ) : null}
                </p>
              </div>
            </section>
          </div>

          <div className="mt-6 h-px bg-default-200/20" />
          <section className="mt-5 pt-2">
            <p className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-danger-300/90">
              <TriangleAlert className="h-3.5 w-3.5" />
              Danger Zone
            </p>
            <p className="mt-1 text-xs text-default-400">
              Permanently delete your account and all associated data. This can&apos;t be undone.
            </p>
            <Button
              className="mt-3"
              color="danger"
              isLoading={deletePending}
              size="sm"
              variant="bordered"
              onPress={handleDeleteAccount}
            >
              Delete account
            </Button>
            {deleteError ? <p className="mt-2 text-xs text-danger-300">{deleteError}</p> : null}
          </section>
        </div>

        <div className="flex items-center justify-between border-t border-default-200/30 px-5 py-4 md:px-6">
          <p className={`text-xs ${saveError ? "text-danger-300" : "text-success-400"}`}>
            {saveError ?? saveSuccess ?? ""}
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="flat"
              onPress={() => {
                void closeProfileModal();
              }}
            >
              Cancel
            </Button>
            <Button
              color="primary"
              isDisabled={!hasUnsavedChanges || avatarPending}
              isLoading={savePending}
              size="sm"
              onPress={handleSaveProfile}
            >
              {savePending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  ) : null;

  const settingsDrawer = canAccessSettings ? (
    <Drawer
      classNames={{
        wrapper: "z-[240]",
      }}
      isOpen={isSettingsDrawerOpen}
      placement="right"
      scrollBehavior="inside"
      size="xs"
      onOpenChange={(open) => setIsSettingsDrawerOpen(open)}
    >
      <DrawerContent>
        {(onClose) => (
          <>
            <DrawerHeader className="border-b border-default-200/40 pb-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-default-500">Settings</p>
                <p className="text-sm font-semibold text-default-200">Quick Links</p>
              </div>
            </DrawerHeader>
            <DrawerBody className="py-4">
              <Link
                className="block rounded-medium border border-default-200/30 bg-content2/35 px-3 py-2 text-sm font-medium text-[#C79B3B] transition hover:border-default-200/60 hover:bg-content2/60"
                href="/drafts"
                onClick={() => {
                  setIsSettingsDrawerOpen(false);
                  onClose();
                }}
              >
                Drafts
              </Link>
              <button
                className="mt-2 block w-full rounded-medium border border-default-200/30 bg-content2/35 px-3 py-2 text-left text-sm font-medium text-[#C79B3B] transition hover:border-default-200/60 hover:bg-content2/60"
                type="button"
                onClick={() => {
                  setIsSettingsDrawerOpen(false);
                  setIsScoringSettingsOpen(true);
                  onClose();
                }}
              >
                Scoring Settings
              </button>
            </DrawerBody>
            <DrawerFooter className="border-t border-default-200/40 pt-3">
              <button
                className="inline-flex h-9 items-center justify-center rounded-medium border border-default-300/40 bg-content2/60 px-3 text-sm font-medium text-default-200 transition hover:border-default-200/70 hover:bg-content2/80"
                type="button"
                onClick={onClose}
              >
                Close
              </button>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  ) : null;

  const scoringSettingsModal = canAccessSettings ? (
    <ScoringSettingsModal
      initialScoring={initialScoring}
      isOpen={isScoringSettingsOpen}
      onOpenChange={(open) => setIsScoringSettingsOpen(open)}
    />
  ) : null;

  if (layout === "navbar") {
    return (
      <>
        <div className="relative flex items-center gap-2 text-xs text-default-500">
          <Tooltip content="Sign out">
            <span className="inline-flex">
              <SignOutButton
                isIconOnly
                className="inline-flex h-11 w-11 min-h-0 min-w-0 items-center justify-center rounded-medium border border-default-300/40 bg-transparent p-0 text-[var(--insight-gold)] transition data-[hover=true]:border-default-200/70 data-[hover=true]:bg-transparent data-[hover=true]:text-[#d9ab45] sm:h-9 sm:w-9"
              />
            </span>
          </Tooltip>
          {canAccessSettings ? (
            <Tooltip content="Settings">
              <button
                aria-label="Settings"
                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-medium border border-default-300/40 bg-transparent p-0 text-[var(--insight-gold)] transition hover:border-default-200/70 hover:bg-transparent hover:text-[#d9ab45] sm:h-9 sm:w-9"
                type="button"
                onClick={() => setIsSettingsDrawerOpen(true)}
              >
                <Settings size={16} strokeWidth={2} />
              </button>
            </Tooltip>
          ) : null}

          <Tooltip content="Edit profile">
            <button
              aria-label="Edit profile"
              className="cursor-pointer rounded-full p-0"
              type="button"
              onClick={openProfileModal}
            >
              {avatarNode}
            </button>
          </Tooltip>
        </div>
        {profileModal}
        {settingsDrawer}
        {scoringSettingsModal}
      </>
    );
  }

  return (
    <>
      <div className="relative rounded-large border border-default-200/30 bg-default-100/5 p-3 pr-16 text-xs text-default-500">
        <div className="flex min-h-[88px] items-center gap-3">
          <button
            aria-label="Edit profile"
            className="cursor-pointer rounded-full p-0"
            type="button"
            onClick={openProfileModal}
          >
            {avatarNode}
          </button>

          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[11px] uppercase tracking-wide text-default-500">
              Signed in as
            </p>
            <button
              className="max-w-full cursor-pointer truncate bg-transparent p-0 text-left text-sm font-semibold text-[#C79B3B] hover:underline"
              type="button"
              onClick={openProfileModal}
            >
              {activeTeamName ?? "Set Team Name"}
            </button>
            <p className="truncate text-[11px] text-default-500">
              ({activeLabel})
            </p>
          </div>
        </div>

        <div className="absolute right-2 top-2">
          <SignOutButton />
        </div>

        {canAccessSettings ? (
          <div className="absolute bottom-2 right-2">
            <button
              aria-label="Settings"
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-medium border border-transparent bg-transparent p-0 text-default-400 transition hover:border-default-200/40 hover:bg-content2/45 hover:text-default-200 sm:h-8 sm:w-8"
              type="button"
              onClick={() => setIsSettingsDrawerOpen(true)}
            >
              <Settings size={16} strokeWidth={2} />
            </button>
          </div>
        ) : null}
      </div>
      {profileModal}
      {settingsDrawer}
      {scoringSettingsModal}
    </>
  );
};
