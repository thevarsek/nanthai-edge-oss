// components/shared/ModelPickerShared.ts
// Shared sort/filter types and logic for ModelPicker and ChatParticipantPicker.
// Extracted to avoid duplication — both pickers import from here.

import type { ModelSummary } from "./ModelPickerHelpers";
import { resolveImagePrice } from "./ModelPickerHelpers.utils";

// ─── Sort keys (matches iOS ModelPickerSortKey — 9 keys) ─────────────────────

export type SortKey =
  | "recommended" | "coding" | "research" | "fast"
  | "value" | "image" | "price" | "context" | "topThisWeek";

export interface SortKeyEntry {
  key: SortKey;
  labelKey: string;
}

export const SORT_KEYS: SortKeyEntry[] = [
  { key: "recommended", labelKey: "guidance_sort_recommended" },
  { key: "coding", labelKey: "guidance_sort_coding" },
  { key: "research", labelKey: "guidance_sort_research" },
  { key: "fast", labelKey: "guidance_sort_speed" },
  { key: "value", labelKey: "guidance_sort_value" },
  { key: "image", labelKey: "guidance_sort_image" },
  { key: "price", labelKey: "guidance_sort_price" },
  { key: "context", labelKey: "guidance_sort_context" },
  { key: "topThisWeek", labelKey: "guidance_sort_top_this_week" },
];

// ─── Capability filters (matches iOS CapabilityFilter — 5 filters) ───────────

export type CapFilter = "free" | "excludeFree" | "vision" | "imageGen" | "videoGen" | "tools";

export interface CapFilterEntry {
  key: CapFilter;
  labelKey: string;
}

export const CAP_FILTERS: CapFilterEntry[] = [
  { key: "free", labelKey: "guidance_free" },
  { key: "excludeFree", labelKey: "no_free" },
  { key: "vision", labelKey: "guidance_cap_vision" },
  { key: "imageGen", labelKey: "image_gen" },
  { key: "videoGen", labelKey: "video_gen" },
  { key: "tools", labelKey: "guidance_cap_tools" },
];

export function matchesFilter(m: ModelSummary, f: CapFilter): boolean {
  const isFree = m.isFree ?? m.modelId.endsWith(":free");
  switch (f) {
    case "free": return isFree;
    case "excludeFree": return !isFree;
    case "vision": {
      return modelSupportsVisionInput(m);
    }
    case "imageGen": return m.supportsImages ?? false;
    case "videoGen": return m.supportsVideo ?? false;
    case "tools": return m.supportsTools ?? false;
  }
}

export function modelSupportsVisionInput(m: ModelSummary): boolean {
  if ((m.mediaCapabilities?.image?.maxInputReferences ?? 0) > 0) {
    return true;
  }
  if (m.supportsVideo) {
    return (m.supportedFrameImages?.length ?? 0) > 0;
  }
  const modality = m.architecture?.modality ?? "";
  const inputSide = modality.split("->")[0] ?? "";
  return inputSide.includes("image");
}

export function modelHasImageOutput(m: ModelSummary): boolean {
  const outputSide = (m.architecture?.modality ?? "").split("->")[1] ?? "";
  return m.supportsImages === true || outputSide.includes("image");
}

export function modelIsZdrEligible(m: ModelSummary): boolean {
  return m.hasZdrEndpoint === true && !modelHasImageOutput(m);
}

/** Models safe for text-only ancillary work such as titles and memory extraction. */
export function modelHasTextOnlyOutput(m: ModelSummary): boolean {
  const outputSide = (m.architecture?.modality ?? "").split("->")[1] ?? "";
  return !modelHasImageOutput(m) &&
    m.supportsVideo !== true &&
    !outputSide.includes("video") &&
    !outputSide.includes("audio");
}

export function modelProviderIdentifiers(modelId: string, provider?: string | null): Set<string> {
  const identifiers = new Set<string>();
  if (provider) identifiers.add(provider.toLowerCase());
  const slug = modelId.split("/")[0];
  if (slug) identifiers.add(slug.toLowerCase());
  return identifiers;
}

export function isProviderAllowedForGoogle(modelId: string, provider?: string | null): boolean {
  const allowed = new Set(["openai", "anthropic", "google"]);
  for (const identifier of modelProviderIdentifiers(modelId, provider)) {
    if (allowed.has(identifier)) return true;
  }
  return false;
}

// ─── Sort metric ─────────────────────────────────────────────────────────────

export function sortMetric(m: ModelSummary, key: SortKey): number | null {
  switch (key) {
    case "price": return priceSortMetric(m);
    case "context": return m.contextLength ?? null;
    case "topThisWeek": {
      const ranks = m.openRouterUseCases?.map((uc) => uc.returnedRank);
      return ranks && ranks.length > 0 ? Math.min(...ranks) : null;
    }
    default: return m.derivedGuidance?.scores?.[key] ?? null;
  }
}

function priceSortMetric(m: ModelSummary): number | null {
  if (m.isFree ?? m.modelId.endsWith(":free")) return 0;
  if (m.supportsVideo && m.videoPricing) {
    if (m.videoPricing.perVideoSecond != null && m.videoPricing.perVideoSecond > 0) {
      return m.videoPricing.perVideoSecond;
    }
    if (m.videoPricing.perVideoSecond1080p != null && m.videoPricing.perVideoSecond1080p > 0) {
      return m.videoPricing.perVideoSecond1080p;
    }
    if (m.videoPricing.perVideoToken != null && m.videoPricing.perVideoToken > 0) {
      return m.videoPricing.perVideoToken * 1_000_000;
    }
    if (m.videoPricing.perVideoTokenNoAudio != null && m.videoPricing.perVideoTokenNoAudio > 0) {
      return m.videoPricing.perVideoTokenNoAudio * 1_000_000;
    }
  }
  const imagePrice = resolveImagePrice(m.imagePricing);
  if (m.supportsImages && imagePrice) {
    return imagePrice.amount;
  }
  return (m.inputPricePer1M ?? 0) + (m.outputPricePer1M ?? 0) || null;
}

/** Default direction: price & topThisWeek ascending (lower=better), rest descending. */
export function defaultAsc(key: SortKey): boolean {
  return key === "price" || key === "topThisWeek";
}

// ─── Sort & filter pipeline ──────────────────────────────────────────────────

export function filterAndSortModels(
  models: ModelSummary[],
  search: string,
  sortKey: SortKey,
  activeFilters: Set<CapFilter>,
): ModelSummary[] {
  const q = search.toLowerCase();
  return models
    .filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !m.modelId.toLowerCase().includes(q) && !(m.provider ?? "").toLowerCase().includes(q)) return false;
      for (const f of activeFilters) { if (!matchesFilter(m, f)) return false; }
      return true;
    })
    .sort((a, b) => {
      const sa = sortMetric(a, sortKey);
      const sb = sortMetric(b, sortKey);
      if (sa == null && sb == null) return a.name.localeCompare(b.name);
      if (sa == null) return 1;
      if (sb == null) return -1;
      const asc = defaultAsc(sortKey);
      return asc ? sa - sb : sb - sa;
    });
}

// ─── Toggle filter helper ────────────────────────────────────────────────────

export function toggleCapFilter(prev: Set<CapFilter>, f: CapFilter): Set<CapFilter> {
  const next = new Set(prev);
  if (next.has(f)) {
    next.delete(f);
  } else {
    // free / excludeFree are mutually exclusive
    if (f === "free") next.delete("excludeFree");
    if (f === "excludeFree") next.delete("free");
    next.add(f);
  }
  return next;
}

// ─── Output modality category (mirrors convex/lib/modality_utils.ts) ─────────

export type OutputModalityCategory = "text" | "image" | "video";

/**
 * Derive the output modality category for a model summary.
 * Mirrors backend getModelModalityCategory / getOutputModalityCategory.
 *
 *   "video" — supportsVideo or output contains "video"
 *   "image" — supportsImages and output does NOT contain "text" (pure image gen)
 *   "text"  — everything else (default)
 */
export function getModelOutputModality(m: ModelSummary): OutputModalityCategory {
  if (m.supportsVideo) return "video";

  const modality = m.architecture?.modality ?? "";
  const outputSide = modality.split("->")[1] ?? "";

  if (outputSide.includes("video")) return "video";
  if (m.supportsImages && !outputSide.includes("text")) return "image";
  if (outputSide.includes("image") && !outputSide.includes("text")) return "image";
  return "text";
}
