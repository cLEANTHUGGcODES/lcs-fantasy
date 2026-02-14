"use client";

import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from "@heroui/drawer";
import { Tooltip } from "@heroui/tooltip";
import { Settings, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { CSSProperties, useEffect, useState } from "react";
import { DisplayNameForm } from "@/components/auth/display-name-form";
import { ProfileImageForm } from "@/components/auth/profile-image-form";
import { ScoringSettingsModal } from "@/components/auth/scoring-settings-modal";
import { SignOutButton } from "@/components/auth/sign-out-button";
import type { FantasyScoring } from "@/types/fantasy";

const initialsForName = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

type AccountWidgetLayout = "card" | "navbar";

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
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [isScoringSettingsOpen, setIsScoringSettingsOpen] = useState(false);
  const [activeLabel, setActiveLabel] = useState(userLabel);
  const [activeFirstName, setActiveFirstName] = useState(firstName);
  const [activeLastName, setActiveLastName] = useState(lastName);
  const [activeTeamName, setActiveTeamName] = useState(teamName);
  const [activeAvatarPath, setActiveAvatarPath] = useState(avatarPath);
  const [activeAvatarBorderColor, setActiveAvatarBorderColor] = useState(avatarBorderColor);
  const [activeAvatarUrl, setActiveAvatarUrl] = useState(avatarUrl);
  const [draftAvatarBorderColor, setDraftAvatarBorderColor] = useState(avatarBorderColor);
  const activeAvatarBorderStyle: CSSProperties | undefined = activeAvatarBorderColor
    ? { outlineColor: activeAvatarBorderColor }
    : undefined;
  const draftAvatarBorderStyle: CSSProperties | undefined = draftAvatarBorderColor
    ? { outlineColor: draftAvatarBorderColor }
    : undefined;

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

  const openProfileModal = () => {
    setDraftAvatarBorderColor(activeAvatarBorderColor);
    setIsOpen(true);
    setIsSettingsDrawerOpen(false);
    setIsScoringSettingsOpen(false);
  };

  const closeProfileModal = () => {
    setIsOpen(false);
    setDraftAvatarBorderColor(activeAvatarBorderColor);
  };

  const avatarNode = activeAvatarUrl ? (
    <span
      className={`relative inline-flex overflow-hidden rounded-full bg-default-200/30 outline outline-2 outline-default-300/40 ${
        layout === "navbar" ? "h-9 w-9" : "h-14 w-14"
      }`}
      style={activeAvatarBorderStyle}
    >
      <Image
        src={activeAvatarUrl}
        alt={`${activeLabel} profile image`}
        fill
        sizes={layout === "navbar" ? "36px" : "56px"}
        quality={100}
        unoptimized
        className="object-cover object-center"
      />
    </span>
  ) : (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-default-200/40 font-semibold text-default-600 outline outline-2 outline-default-300/40 ${
        layout === "navbar" ? "h-9 w-9 text-xs" : "h-14 w-14 text-sm"
      }`}
      style={activeAvatarBorderStyle}
    >
      {initialsForName(activeLabel)}
    </span>
  );

  const profileModal = isOpen ? (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-5 backdrop-blur-[2px] sm:items-center sm:py-6"
      onClick={closeProfileModal}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-[20px] border border-default-200/40 bg-content1/95 p-5 shadow-2xl backdrop-blur-md md:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-default-500">Profile Settings</p>
            <p className="text-sm font-semibold text-default-200">{activeLabel}</p>
          </div>
          <div className="flex items-center gap-1">
            <SignOutButton
              isIconOnly
              className="inline-flex h-8 w-8 min-h-0 min-w-0 items-center justify-center rounded-medium border border-default-300/40 bg-content2/60 p-0 text-white data-[hover=true]:border-default-200/70 data-[hover=true]:bg-content2/80 data-[hover=true]:text-white"
            />
            <button
              aria-label="Close profile settings"
              className="inline-flex h-8 w-8 items-center justify-center rounded-medium border border-default-300/40 bg-content2/60 p-0 text-white transition hover:border-default-200/70 hover:bg-content2/80 hover:text-white"
              type="button"
              onClick={closeProfileModal}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[220px_1fr] md:items-stretch">
            <div className="rounded-large border border-default-200/30 bg-default-100/5 p-4">
              <div className="mb-3 flex justify-center">
                {activeAvatarUrl ? (
                  <span
                    className="relative inline-flex h-28 w-28 overflow-hidden rounded-full bg-default-200/30 outline outline-2 outline-default-300/40"
                    style={draftAvatarBorderStyle}
                  >
                    <Image
                      src={activeAvatarUrl}
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
                    className="inline-flex h-28 w-28 items-center justify-center rounded-full bg-default-200/40 text-xl font-semibold text-default-600 outline outline-2 outline-default-300/40"
                    style={draftAvatarBorderStyle}
                  >
                    {initialsForName(activeLabel)}
                  </span>
                )}
              </div>
              <p className="mb-2 text-center text-xs text-default-500">Profile image</p>
              <ProfileImageForm
                currentAvatarBorderColor={draftAvatarBorderColor}
                currentAvatarPath={activeAvatarPath}
                onSaved={({
                  avatarPath: nextPath,
                  avatarUrl: nextUrl,
                  avatarBorderColor: nextBorderColor,
                }) => {
                  if (nextPath !== undefined) {
                    setActiveAvatarPath(nextPath);
                  }
                  if (nextUrl !== undefined) {
                    setActiveAvatarUrl(nextUrl);
                  }
                  if (nextBorderColor !== undefined) {
                    setDraftAvatarBorderColor(nextBorderColor);
                  }
                }}
              />
            </div>

            <div className="h-full rounded-large border border-default-200/30 bg-default-100/5 p-4">
              <DisplayNameForm
                initialFirstName={activeFirstName ?? ""}
                initialLastName={activeLastName ?? ""}
                initialTeamName={activeTeamName ?? ""}
                additionalMetadata={{
                  avatar_border_color: draftAvatarBorderColor,
                }}
                pinSubmitToBottom
                saveLabel="Save"
                showSavedMessage={false}
                onSaved={({
                  firstName: nextFirstName,
                  lastName: nextLastName,
                  teamName: nextTeamName,
                  displayLabel,
                }) => {
                  setActiveFirstName(nextFirstName);
                  setActiveLastName(nextLastName);
                  setActiveTeamName(nextTeamName);
                  setActiveAvatarBorderColor(draftAvatarBorderColor);
                  setActiveLabel(displayLabel);
                  setIsOpen(false);
                }}
              />
            </div>
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
                className="inline-flex h-9 w-9 min-h-0 min-w-0 items-center justify-center rounded-medium border border-default-300/40 bg-transparent p-0 text-[var(--insight-gold)] transition data-[hover=true]:border-default-200/70 data-[hover=true]:bg-transparent data-[hover=true]:text-[#d9ab45]"
              />
            </span>
          </Tooltip>
          {canAccessSettings ? (
            <Tooltip content="Settings">
              <button
                aria-label="Settings"
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-medium border border-default-300/40 bg-transparent p-0 text-[var(--insight-gold)] transition hover:border-default-200/70 hover:bg-transparent hover:text-[#d9ab45]"
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
              className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-medium border border-transparent bg-transparent p-0 text-default-400 transition hover:border-default-200/40 hover:bg-content2/45 hover:text-default-200"
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
