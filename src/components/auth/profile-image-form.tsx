"use client";

import { Button } from "@heroui/button";
import { ChangeEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseAuthEnv } from "@/lib/supabase-auth-env";
import { PROFILE_IMAGES_BUCKET, getPublicStorageUrl } from "@/lib/supabase-storage";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_BORDER_COLOR = "#c79b3b";

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

type ProfileImageFormProps = {
  currentAvatarBorderColor: string | null;
  currentAvatarPath: string | null;
  onSaved?: (payload: {
    avatarPath?: string | null;
    avatarUrl?: string | null;
    avatarBorderColor?: string | null;
  }) => void;
};

export const ProfileImageForm = ({
  currentAvatarBorderColor,
  currentAvatarPath,
  onSaved,
}: ProfileImageFormProps) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectFile = () => {
    inputRef.current?.click();
  };

  const applyMetadataUpdate = async ({
    avatarPath,
  }: {
    avatarPath?: string | null;
  }) => {
    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      throw new Error(userError?.message ?? "Unable to load current user.");
    }

    const metadata = user.user_metadata && typeof user.user_metadata === "object"
      ? (user.user_metadata as Record<string, unknown>)
      : {};
    const nextData: Record<string, unknown> = { ...metadata };

    if (avatarPath !== undefined) {
      nextData.avatar_path = avatarPath;
    }

    const { error: updateError } = await supabase.auth.updateUser({
      data: nextData,
    });

    if (updateError) {
      throw new Error(updateError.message);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      return;
    }

    setError(null);
    setMessage(null);

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    const supabase = getSupabaseBrowserClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      setError(userError?.message ?? "Unable to load current user.");
      return;
    }

    const ext = extensionForFile(file);
    const nextPath = `${user.id}/avatar-${Date.now()}.${ext}`;

    setPending(true);
    const { error: uploadError } = await supabase.storage
      .from(PROFILE_IMAGES_BUCKET)
      .upload(nextPath, file, {
        cacheControl: "3600",
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      setPending(false);
      setError(uploadError.message);
      return;
    }

    try {
      await applyMetadataUpdate({ avatarPath: nextPath });
    } catch (updateError) {
      await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([nextPath]);
      setPending(false);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to save profile image metadata.",
      );
      return;
    }

    if (currentAvatarPath && currentAvatarPath !== nextPath) {
      await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([currentAvatarPath]);
    }

    const { supabaseUrl } = getSupabaseAuthEnv();
    const avatarUrl = getPublicStorageUrl({
      supabaseUrl,
      bucket: PROFILE_IMAGES_BUCKET,
      path: nextPath,
    });

    setPending(false);
    setMessage("Profile image updated.");
    onSaved?.({ avatarPath: nextPath, avatarUrl });
    router.refresh();
  };

  const handleRemove = async () => {
    if (!currentAvatarPath) {
      return;
    }

    setPending(true);
    setError(null);
    setMessage(null);
    const supabase = getSupabaseBrowserClient();

    try {
      await applyMetadataUpdate({ avatarPath: null });
    } catch (updateError) {
      setPending(false);
      setError(
        updateError instanceof Error
          ? updateError.message
          : "Unable to clear profile image metadata.",
      );
      return;
    }

    await supabase.storage.from(PROFILE_IMAGES_BUCKET).remove([currentAvatarPath]);

    setPending(false);
    setMessage("Profile image removed.");
    onSaved?.({ avatarPath: null, avatarUrl: null });
    router.refresh();
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        type="file"
        onChange={handleFileChange}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button color="primary" isLoading={pending} size="sm" variant="flat" onPress={selectFile}>
          Upload Image
        </Button>
        <Button
          isDisabled={!currentAvatarPath || pending}
          size="sm"
          variant="light"
          onPress={handleRemove}
        >
          Remove
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-[11px] font-medium uppercase tracking-wide text-default-500" htmlFor="avatar-border-color">
          Border Color
        </label>
        <input
          id="avatar-border-color"
          className="h-8 w-10 cursor-pointer rounded border border-default-300/50 bg-transparent p-0"
          disabled={pending}
          type="color"
          value={currentAvatarBorderColor ?? DEFAULT_BORDER_COLOR}
          onChange={(event) => onSaved?.({ avatarBorderColor: event.target.value.toLowerCase() })}
        />
        <Button
          isDisabled={pending}
          size="sm"
          variant="light"
          onPress={() => onSaved?.({ avatarBorderColor: null })}
        >
          Use Default
        </Button>
      </div>
      {error ? <p className="text-xs text-danger-400">{error}</p> : null}
      {message ? <p className="text-xs text-success-400">{message}</p> : null}
      <p className="text-[11px] text-default-500">JPG, PNG, WEBP up to 3MB. Color saves when you click Save.</p>
    </div>
  );
};
