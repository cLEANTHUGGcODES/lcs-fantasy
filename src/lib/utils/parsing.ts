// TODO: add js-doc comments to all of these functions

export const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

export const asNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number.parseInt(`${value ?? ""}`, 10) || 0;

export const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const asBoolean = (value: unknown): boolean => value === true;
