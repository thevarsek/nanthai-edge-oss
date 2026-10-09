import { useCallback, useState } from "react";
import type { CapFilter } from "@/components/shared/ModelPickerShared";
import { usePreferenceBuffer } from "./usePreferenceBuffer";

interface FilterPreferences {
  pickerFilterFree?: boolean; pickerFilterExcludeFree?: boolean; pickerFilterVision?: boolean;
  pickerFilterImageGen?: boolean; pickerFilterVideoGen?: boolean; pickerFilterTools?: boolean;
}
const fields = { free: "pickerFilterFree", excludeFree: "pickerFilterExcludeFree", vision: "pickerFilterVision", imageGen: "pickerFilterImageGen", videoGen: "pickerFilterVideoGen", tools: "pickerFilterTools" } as const;
export function filtersFromPreferences(prefs?: FilterPreferences | null): Set<CapFilter> {
  return new Set((Object.keys(fields) as CapFilter[]).filter(key => prefs?.[fields[key]] === true));
}
export function useModelPickerFilters(prefs?: FilterPreferences | null) {
  const [override, setOverride] = useState<Set<CapFilter> | null>(null);
  const { updatePreferenceImmediate } = usePreferenceBuffer();
  const active = override ?? filtersFromPreferences(prefs);
  const set = useCallback((update: Set<CapFilter> | ((old: Set<CapFilter>) => Set<CapFilter>)) => {
    const next = typeof update === "function" ? update(override ?? filtersFromPreferences(prefs)) : update;
    setOverride(next);
    updatePreferenceImmediate(Object.fromEntries(Object.entries(fields).map(([key, field]) => [field, next.has(key as CapFilter)])));
  }, [override, prefs, updatePreferenceImmediate]);
  return [active, set] as const;
}
