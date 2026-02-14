import type { User } from "@supabase/supabase-js";
import { PROFILE_IMAGES_BUCKET, getPublicStorageUrl } from "@/lib/supabase-storage";

const HEX_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const readStringField = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/g, " ");

const normalizeHexColor = (value: string): string | null => {
  const normalized = value.trim().toLowerCase();
  if (!HEX_COLOR_REGEX.test(normalized)) {
    return null;
  }

  if (normalized.length === 4) {
    return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
  }

  return normalized;
};

const toNameCaseWord = (value: string): string => {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }

  return normalized
    .toLowerCase()
    .split(/([-'`])/)
    .map((segment) => {
      if (!segment || segment === "-" || segment === "'" || segment === "`") {
        return segment;
      }
      return segment[0].toUpperCase() + segment.slice(1);
    })
    .join("");
};

export const normalizePersonName = (value: string): string =>
  normalizeWhitespace(value)
    .split(" ")
    .map((word) => toNameCaseWord(word))
    .filter(Boolean)
    .join(" ");

export const normalizeTeamName = (value: string): string =>
  value.trim();

export const normalizeAvatarBorderColor = (value: unknown): string | null => {
  const raw = readStringField(value);
  if (!raw) {
    return null;
  }

  return normalizeHexColor(raw);
};

const parseNameParts = (value: string): { firstName: string | null; lastName: string | null } => {
  const raw = normalizeWhitespace(value);
  const prepared = raw.includes("@")
    ? (raw.split("@")[0] ?? "").replace(/[._-]+/g, " ")
    : raw;
  const normalized = normalizePersonName(prepared);
  if (!normalized) {
    return { firstName: null, lastName: null };
  }

  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length === 0) {
    return { firstName: null, lastName: null };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
};

const formatFirstAndLastInitial = ({
  firstName,
  lastName,
}: {
  firstName: string | null;
  lastName: string | null;
}): string | null => {
  if (!firstName) {
    return null;
  }

  if (!lastName) {
    return firstName;
  }

  const initial = [...lastName][0];
  if (!initial) {
    return firstName;
  }

  return `${firstName} ${initial.toUpperCase()}.`;
};

const readMetadataNameField = (metadata: unknown, keys: string[]): string | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  for (const key of keys) {
    const candidate = readStringField(record[key]);
    if (candidate) {
      return candidate;
    }
  }

  return null;
};

const readDisplayNameFromMetadata = (metadata: unknown): string | null => {
  return (
    readMetadataNameField(metadata, [
      "display_name",
      "displayName",
      "full_name",
      "fullName",
      "name",
    ]) ??
    null
  );
};

const readFirstNameFromMetadata = (metadata: unknown): string | null =>
  readMetadataNameField(metadata, ["first_name", "firstName", "given_name", "givenName"]);

const readLastNameFromMetadata = (metadata: unknown): string | null =>
  readMetadataNameField(metadata, ["last_name", "lastName", "family_name", "familyName"]);

const readTeamNameFromMetadata = (metadata: unknown): string | null =>
  readMetadataNameField(metadata, ["team_name", "teamName", "favorite_team", "favoriteTeam", "team"]);

const readLabelFromEmail = (email: string | null | undefined): string | null => {
  const raw = readStringField(email);
  if (!raw) {
    return null;
  }

  const localPart = raw.split("@")[0] ?? "";
  const cleaned = localPart.replace(/[._-]+/g, " ");
  const parsed = parseNameParts(cleaned);
  return formatFirstAndLastInitial(parsed);
};

const resolveNameParts = ({
  metadata,
  fallbackDisplayName,
}: {
  metadata: unknown;
  fallbackDisplayName: string | null;
}): { firstName: string | null; lastName: string | null } => {
  const firstFromMetadata = readFirstNameFromMetadata(metadata);
  const lastFromMetadata = readLastNameFromMetadata(metadata);

  if (firstFromMetadata || lastFromMetadata) {
    return {
      firstName: firstFromMetadata ? normalizePersonName(firstFromMetadata) : null,
      lastName: lastFromMetadata ? normalizePersonName(lastFromMetadata) : null,
    };
  }

  if (!fallbackDisplayName) {
    return { firstName: null, lastName: null };
  }

  return parseNameParts(fallbackDisplayName);
};

export const formatUserLabelFromDisplayName = (value: string | null): string | null => {
  const raw = readStringField(value);
  if (!raw) {
    return null;
  }
  const parsed = parseNameParts(raw);
  return formatFirstAndLastInitial(parsed);
};

export const getUserFirstName = (user: User | null): string | null => {
  if (!user) {
    return null;
  }

  const fallbackDisplayName = readDisplayNameFromMetadata(user.user_metadata);
  const parts = resolveNameParts({
    metadata: user.user_metadata,
    fallbackDisplayName,
  });
  return parts.firstName;
};

export const getUserLastName = (user: User | null): string | null => {
  if (!user) {
    return null;
  }

  const fallbackDisplayName = readDisplayNameFromMetadata(user.user_metadata);
  const parts = resolveNameParts({
    metadata: user.user_metadata,
    fallbackDisplayName,
  });
  return parts.lastName;
};

export const getUserTeamName = (user: User | null): string | null => {
  if (!user) {
    return null;
  }

  const teamFromMetadata = readTeamNameFromMetadata(user.user_metadata);
  return teamFromMetadata ? normalizeTeamName(teamFromMetadata) : null;
};

export const getUserDisplayName = (user: User | null): string | null => {
  if (!user) {
    return null;
  }

  const fallbackDisplayName = readDisplayNameFromMetadata(user.user_metadata);
  const parts = resolveNameParts({
    metadata: user.user_metadata,
    fallbackDisplayName,
  });

  return (
    formatFirstAndLastInitial(parts) ??
    formatUserLabelFromDisplayName(fallbackDisplayName) ??
    readLabelFromEmail(user.email) ??
    null
  );
};

const readAvatarPathFromMetadata = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  return readStringField(record.avatar_path) ?? readStringField(record.avatarPath) ?? null;
};

const readAvatarBorderColorFromMetadata = (metadata: unknown): string | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const record = metadata as Record<string, unknown>;
  return (
    normalizeAvatarBorderColor(record.avatar_border_color) ??
    normalizeAvatarBorderColor(record.avatarBorderColor) ??
    normalizeAvatarBorderColor(record.profile_border_color) ??
    normalizeAvatarBorderColor(record.profileBorderColor) ??
    null
  );
};

export const getUserAvatarPath = (user: User | null): string | null =>
  user ? readAvatarPathFromMetadata(user.user_metadata) : null;

export const getUserAvatarBorderColor = (user: User | null): string | null =>
  user ? readAvatarBorderColorFromMetadata(user.user_metadata) : null;

export const getUserAvatarUrl = ({
  user,
  supabaseUrl,
}: {
  user: User | null;
  supabaseUrl: string;
}): string | null => {
  const avatarPath = getUserAvatarPath(user);
  if (!avatarPath) {
    return null;
  }

  return getPublicStorageUrl({
    supabaseUrl,
    bucket: PROFILE_IMAGES_BUCKET,
    path: avatarPath,
  });
};
