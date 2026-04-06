import { useRef, useMemo, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

/**
 * Returns a debounced `updatePreference` function that **merges** successive
 * patches into a single backend write. Safe to call on every keystroke or
 * rapid select change — patches accumulate so no writes are silently dropped.
 *
 * Also provides `updatePreferenceImmediate` for selects/dropdowns where the
 * user expects instant feedback (no 500ms debounce).
 */
export function usePreferenceBuffer() {
  const upsert = useMutation(api.preferences.mutations.upsertPreferences);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flush = useCallback(() => {
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    void upsert(patch as Parameters<typeof upsert>[0]);
  }, [upsert]);

  /** Debounced (500ms) — merges concurrent patches. Best for sliders/text. */
  const updatePreference = useMemo(
    () => (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    [flush],
  );

  /** Immediate — fires right away, also flushes any pending debounced patch.
   *  Best for selects/dropdowns where the user expects instant UI response. */
  const updatePreferenceImmediate = useCallback(
    (patch: Record<string, unknown>) => {
      clearTimeout(timer.current);
      const merged = { ...pending.current, ...patch };
      pending.current = {};
      void upsert(merged as Parameters<typeof upsert>[0]);
    },
    [upsert],
  );

  return { updatePreference, updatePreferenceImmediate };
}
