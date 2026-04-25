// TODO: add js-doc comments to all of these functions

export const normalizeGlobalChatMessage = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

export const formatChatReactionUserLabel = (value: string): string => {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Unknown";
  }
  const parts = compact.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return parts[0];
  }
  const firstName = parts[0];
  const lastInitial = parts[parts.length - 1]?.[0]?.toUpperCase();
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
};
