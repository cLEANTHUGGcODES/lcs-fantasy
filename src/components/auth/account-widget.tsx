"use client";

import { Settings, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DisplayNameForm } from "@/components/auth/display-name-form";
import { ProfileImageForm } from "@/components/auth/profile-image-form";
import { SignOutButton } from "@/components/auth/sign-out-button";

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
  avatarUrl,
  canAccessSettings,
  layout = "card",
}: {
  userLabel: string;
  firstName: string | null;
  lastName: string | null;
  teamName: string | null;
  avatarPath: string | null;
  avatarUrl: string | null;
  canAccessSettings: boolean;
  layout?: AccountWidgetLayout;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeLabel, setActiveLabel] = useState(userLabel);
  const [activeFirstName, setActiveFirstName] = useState(firstName);
  const [activeLastName, setActiveLastName] = useState(lastName);
  const [activeTeamName, setActiveTeamName] = useState(teamName);
  const [activeAvatarPath, setActiveAvatarPath] = useState(avatarPath);
  const [activeAvatarUrl, setActiveAvatarUrl] = useState(avatarUrl);

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

  const toggleProfileModal = () => {
    setIsOpen((open) => !open);
    setIsSettingsOpen(false);
  };

  const avatarNode = activeAvatarUrl ? (
    <span
      className={`relative inline-flex overflow-hidden rounded-full border border-default-300/40 bg-default-200/30 ${
        layout === "navbar" ? "h-10 w-10" : "h-14 w-14"
      }`}
    >
      <Image
        src={activeAvatarUrl}
        alt={`${activeLabel} profile image`}
        fill
        sizes={layout === "navbar" ? "40px" : "56px"}
        quality={100}
        unoptimized
        className="object-cover object-center"
      />
    </span>
  ) : (
    <span
      className={`inline-flex items-center justify-center rounded-full border border-default-300/40 bg-default-200/40 font-semibold text-default-600 ${
        layout === "navbar" ? "h-10 w-10 text-xs" : "h-14 w-14 text-sm"
      }`}
    >
      {initialsForName(activeLabel)}
    </span>
  );

  const profileModal = isOpen ? (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-5 backdrop-blur-[2px] sm:items-center sm:py-6"
      onClick={() => setIsOpen(false)}
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
              onClick={() => setIsOpen(false)}
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
                  <span className="relative inline-flex h-28 w-28 overflow-hidden rounded-full border border-default-300/40 bg-default-200/30">
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
                  <span className="inline-flex h-28 w-28 items-center justify-center rounded-full border border-default-300/40 bg-default-200/40 text-xl font-semibold text-default-600">
                    {initialsForName(activeLabel)}
                  </span>
                )}
              </div>
              <p className="mb-2 text-center text-xs text-default-500">Profile image</p>
              <ProfileImageForm
                currentAvatarPath={activeAvatarPath}
                onSaved={({ avatarPath: nextPath, avatarUrl: nextUrl }) => {
                  setActiveAvatarPath(nextPath);
                  setActiveAvatarUrl(nextUrl);
                }}
              />
            </div>

            <div className="h-full rounded-large border border-default-200/30 bg-default-100/5 p-4">
              <DisplayNameForm
                initialFirstName={activeFirstName ?? ""}
                initialLastName={activeLastName ?? ""}
                initialTeamName={activeTeamName ?? ""}
                pinSubmitToBottom
                saveLabel="Update Team Name"
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

  if (layout === "navbar") {
    return (
      <>
        <div className="relative flex items-center gap-2 text-xs text-default-500">
          <SignOutButton
            isIconOnly
            className="inline-flex h-9 w-9 min-h-0 min-w-0 items-center justify-center rounded-medium border border-default-300/40 bg-content2/60 p-0 text-white transition data-[hover=true]:border-default-200/70 data-[hover=true]:bg-content2/80 data-[hover=true]:text-white"
          />
          {canAccessSettings ? (
            <div className="relative">
              <button
                aria-label="Settings"
                className="inline-flex h-9 w-9 items-center justify-center rounded-medium border border-default-300/40 bg-content2/60 p-0 text-white transition hover:border-default-200/70 hover:text-white"
                type="button"
                onClick={() => setIsSettingsOpen((open) => !open)}
              >
                <Settings size={16} strokeWidth={2} />
              </button>
              {isSettingsOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.45rem)] z-20 w-[180px] rounded-large border border-default-200/40 bg-content1/95 p-2 shadow-large backdrop-blur-md">
                  <Link
                    className="block rounded-medium px-2 py-1 text-sm text-default-300 hover:bg-default-100/10"
                    href="/drafts"
                    onClick={() => setIsSettingsOpen(false)}
                  >
                    Drafts
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <button
            aria-label="Edit profile"
            className="cursor-pointer rounded-full p-0"
            type="button"
            onClick={toggleProfileModal}
          >
            {avatarNode}
          </button>
        </div>
        {profileModal}
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
            onClick={toggleProfileModal}
          >
            {avatarNode}
          </button>

          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[11px] uppercase tracking-wide text-default-500">
              Signed in as
            </p>
            <button
              className="max-w-full cursor-pointer truncate bg-transparent p-0 text-left text-sm font-semibold text-[#e8c35a] hover:underline"
              type="button"
              onClick={toggleProfileModal}
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
              className="cursor-pointer bg-transparent p-0 text-default-400 hover:text-default-200"
              type="button"
              onClick={() => setIsSettingsOpen((open) => !open)}
            >
              <Settings size={16} strokeWidth={2} />
            </button>
            {isSettingsOpen ? (
              <div className="absolute bottom-full right-0 z-20 mb-2 w-[180px] rounded-large border border-default-200/40 bg-content1/95 p-2 shadow-large backdrop-blur-md">
                <Link
                  className="block rounded-medium px-2 py-1 text-sm text-default-300 hover:bg-default-100/10"
                  href="/drafts"
                  onClick={() => setIsSettingsOpen(false)}
                >
                  Drafts
                </Link>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {profileModal}
    </>
  );
};
