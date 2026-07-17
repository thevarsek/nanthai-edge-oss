import type { Id } from "../_generated/dataModel";

const OMITTED_STORAGE_ID_SENTINELS = new Set([
  "**omit**",
  "__omit__",
  "omit",
  "omitted",
  "undefined",
  "null",
  "none",
  "n/a",
]);

export function optionalPresentationStorageId(
  value: unknown,
): Id<"_storage"> | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || OMITTED_STORAGE_ID_SENTINELS.has(normalized.toLowerCase())) {
    return undefined;
  }
  return normalized as Id<"_storage">;
}

export function presentationAssetStorageIds(
  value: unknown,
): Array<Id<"_storage">> | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value
    .map(optionalPresentationStorageId)
    .filter((id): id is Id<"_storage"> => id !== undefined);
  return ids.length > 0 ? [...new Set(ids)] : undefined;
}
