import { useRef, useMemo, useCallback, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

const PENDING_PREFERENCES_STORAGE_KEY = "nanthai.preferences.pendingPatch";

function readStoredPendingPatch(): Record<string, unknown> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(PENDING_PREFERENCES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      localStorage.removeItem(PENDING_PREFERENCES_STORAGE_KEY);
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    localStorage.removeItem(PENDING_PREFERENCES_STORAGE_KEY);
    return {};
  }
}

function writeStoredPendingPatch(patch: Record<string, unknown>) {
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(patch).length === 0) {
      localStorage.removeItem(PENDING_PREFERENCES_STORAGE_KEY);
      return;
    }
    localStorage.setItem(PENDING_PREFERENCES_STORAGE_KEY, JSON.stringify(patch));
  } catch {
    // Best-effort only: the in-memory buffer still retries while mounted.
  }
}

function mergeStoredPendingPatch(patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) return;
  writeStoredPendingPatch({ ...readStoredPendingPatch(), ...patch });
}

function removeStoredPendingPatch(patch: Record<string, unknown>) {
  const storedPatch = readStoredPendingPatch();
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (key in storedPatch && storedValueMatches(storedPatch[key], value)) {
      delete storedPatch[key];
      changed = true;
    }
  }
  if (changed) {
    writeStoredPendingPatch(storedPatch);
  }
}

function storedValueMatches(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return Object.is(left, right);
  }
}

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
  const restoredStoredPatch = useRef(false);

  const scheduleRetry = useCallback(() => {
    if (!mounted.current) return;
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => flushRef.current(), 1_000);
  }, []);

  const flush = useCallback(() => {
    if (inFlight.current) return;
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    mergeStoredPendingPatch(patch);
    pending.current = {};
    inFlight.current = true;
    void Promise.resolve(upsert(patch as Parameters<typeof upsert>[0]))
      .then(() => {
        inFlight.current = false;
        removeStoredPendingPatch(patch);
        if (Object.keys(pending.current).length > 0) {
          flushRef.current();
        }
      })
      .catch(() => {
        inFlight.current = false;
        pending.current = { ...patch, ...pending.current };
        mergeStoredPendingPatch(pending.current);
        if (!mounted.current) return;
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
      mergeStoredPendingPatch(pending.current);
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
      mergeStoredPendingPatch(pending.current);
      flush();
    },
    [flush],
  );

  useEffect(() => {
    mounted.current = true;
    if (!restoredStoredPatch.current) {
      restoredStoredPatch.current = true;
      const storedPatch = readStoredPendingPatch();
      if (Object.keys(storedPatch).length > 0) {
        pending.current = { ...storedPatch, ...pending.current };
        flush();
      }
    }
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
