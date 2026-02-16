export const MAX_CHAT_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_CHAT_IMAGE_URL_LENGTH = 2048;
export const CHAT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const CHAT_IMAGE_MIME_TYPE_SET = new Set<string>(CHAT_IMAGE_MIME_TYPES);

export const isSupportedChatImageMimeType = (mimeType: string): boolean =>
  CHAT_IMAGE_MIME_TYPE_SET.has(mimeType.trim().toLowerCase());

const extensionFromMimeType = (mimeType: string): string => {
  if (mimeType === "image/png") {
    return "png";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  return "jpg";
};

export const extensionForChatImage = ({
  fileName,
  mimeType,
}: {
  fileName: string;
  mimeType: string;
}): string => {
  const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp"]);
  const lastDotIndex = fileName.lastIndexOf(".");
  const rawExtension =
    lastDotIndex >= 0 ? fileName.slice(lastDotIndex + 1).trim().toLowerCase() : "";
  const normalizedExtension = rawExtension.replace(/[^a-z0-9]/g, "");
  if (normalizedExtension && allowedExtensions.has(normalizedExtension)) {
    return normalizedExtension;
  }
  return extensionFromMimeType(mimeType.trim().toLowerCase());
};

export const normalizeChatImageUrl = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > MAX_CHAT_IMAGE_URL_LENGTH) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
};
