// components/shared/ModelPickerShared.ts
// Shared sort/filter types and logic for ModelPicker and ChatParticipantPicker.
// Extracted to avoid duplication — both pickers import from here.

import type { ModelSummary } from "./ModelPickerHelpers";

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

export type CapFilter = "free" | "excludeFree" | "vision" | "imageGen" | "tools";

export interface CapFilterEntry {
  key: CapFilter;
  labelKey: string;
}

export const CAP_FILTERS: CapFilterEntry[] = [
  { key: "free", labelKey: "guidance_free" },
  { key: "excludeFree", labelKey: "no_free" },
  { key: "vision", labelKey: "guidance_cap_vision" },
  { key: "imageGen", labelKey: "image_gen" },
  { key: "tools", labelKey: "guidance_cap_tools" },
];

export function matchesFilter(m: ModelSummary, f: CapFilter): boolean {
  const isFree = (m.inputPricePer1M ?? 0) === 0 && (m.outputPricePer1M ?? 0) === 0;
  switch (f) {
    case "free": return isFree;
    case "excludeFree": return !isFree;
    case "vision": return m.supportsImages ?? false;
    case "imageGen": return m.architecture?.modality?.includes("image") ?? false;
    case "tools": return m.supportsTools ?? false;
  }
}

// ─── Sort metric ─────────────────────────────────────────────────────────────

export function sortMetric(m: ModelSummary, key: SortKey): number | null {
  switch (key) {
    case "price": return (m.inputPricePer1M ?? 0) + (m.outputPricePer1M ?? 0) || null;
    case "context": return m.contextLength ?? null;
    case "topThisWeek": {
      const ranks = m.openRouterUseCases?.map((uc) => uc.returnedRank);
      return ranks && ranks.length > 0 ? Math.min(...ranks) : null;
    }
    default: return m.derivedGuidance?.scores?.[key] ?? null;
  }
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
