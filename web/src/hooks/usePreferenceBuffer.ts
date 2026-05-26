import { useRef, useMemo, useCallback, useEffect } from "react";
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
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushRef = useRef<() => void>(() => {});
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const scheduleRetry = useCallback(() => {
    if (!mounted.current) return;
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => flushRef.current(), 1_000);
  }, []);

  const flush = useCallback(() => {
    if (inFlight.current) return;
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    pending.current = {};
    inFlight.current = true;
    void Promise.resolve(upsert(patch as Parameters<typeof upsert>[0]))
      .then(() => {
        inFlight.current = false;
        if (Object.keys(pending.current).length > 0) {
          flushRef.current();
        }
      })
      .catch(() => {
        inFlight.current = false;
        if (!mounted.current) return;
        pending.current = { ...patch, ...pending.current };
        scheduleRetry();
      });
  }, [scheduleRetry, upsert]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

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
      pending.current = { ...pending.current, ...patch };
      flush();
    },
    [flush],
  );

  useEffect(() => {
    mounted.current = true;
    const flushPending = () => {
      clearTimeout(timer.current);
      flush();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushPending();
      }
    };

    window.addEventListener("pagehide", flushPending);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      mounted.current = false;
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimeout(retryTimer.current);
      flushPending();
    };
  }, [flush]);

  return { updatePreference, updatePreferenceImmediate };
}
