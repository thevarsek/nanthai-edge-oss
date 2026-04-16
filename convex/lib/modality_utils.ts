// convex/lib/modality_utils.ts
// =============================================================================
// Output-modality category helpers for enforcing same-modality constraints
// on favorites and chat participants.
//
// Three categories:
//   "text"  — default; output contains "text" or does not match image/video.
//             Includes multimodal text+image models (e.g. GPT-4o).
//   "image" — output contains "image" but NOT "text" (pure image generators).
//   "video" — output contains "video" (video generators).
// =============================================================================

import { QueryCtx } from "../_generated/server";

export type OutputModalityCategory = "text" | "image" | "video";

/**
 * Derive the output modality category from a modality string like
 * "text+image->text+image" or "text+image->video".
 *
 * Rules (applied to the output side, i.e. after "->"):
 *   1. If output contains "video" → "video"
 *   2. If output contains "image" but NOT "text" → "image"
 *   3. Everything else → "text"
 */
export function getOutputModalityCategory(
  modality: string | undefined,
): OutputModalityCategory {
  if (!modality) return "text";

  const outputSide = modality.split("->")[1] ?? "";
  if (outputSide.includes("video")) return "video";
  if (outputSide.includes("image") && !outputSide.includes("text")) return "image";
  return "text";
}

/**
 * Look up the output modality category for a model by its modelId
 * using the cachedModels table.
 */
export async function getModelModalityCategory(
  ctx: QueryCtx,
  modelId: string,
): Promise<OutputModalityCategory> {
  const model = await ctx.db
    .query("cachedModels")
    .withIndex("by_modelId", (q) => q.eq("modelId", modelId))
    .first();

  if (!model) return "text"; // Unknown models default to text

  // Prefer explicit flags over modality string parsing
  if (model.supportsVideo) return "video";
  if (model.supportsImages && !model.architecture?.modality?.split("->")[1]?.includes("text")) {
    return "image";
  }

  return getOutputModalityCategory(model.architecture?.modality);
}

/**
 * Validate that all model IDs share the same output modality category.
 * Returns the shared category on success, or throws a descriptive error.
 *
 * When `modelIds` has 0 or 1 entries, validation always passes.
 */
export async function validateSameModality(
  ctx: QueryCtx,
  modelIds: string[],
): Promise<OutputModalityCategory> {
  if (modelIds.length <= 1) {
    return modelIds.length === 1
      ? await getModelModalityCategory(ctx, modelIds[0])
      : "text";
  }

  const categories = await Promise.all(
    modelIds.map((id) => getModelModalityCategory(ctx, id)),
  );
  const first = categories[0];

  for (let i = 1; i < categories.length; i++) {
    if (categories[i] !== first) {
      const a = categories[i];
      const b = first;
      throw new Error(
        modalityMismatchMessage(a, b),
      );
    }
  }

  return first;
}

/**
 * Human-readable error message for modality mismatch.
 */
function modalityMismatchMessage(
  a: OutputModalityCategory,
  b: OutputModalityCategory,
): string {
  const label = (c: OutputModalityCategory) => {
    switch (c) {
      case "text": return "Text";
      case "image": return "Image generation";
      case "video": return "Video generation";
    }
  };
  return `${label(a)} and ${label(b)} models cannot be mixed in the same group.`;
}
