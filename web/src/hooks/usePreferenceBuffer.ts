import { useRef, useMemo, useCallback, useEffect, useLayoutEffect } from "react";
import { useUser } from "@clerk/react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";

const PENDING_PREFERENCES_STORAGE_KEY_PREFIX = "nanthai.preferences.pendingPatch";

function pendingPreferenceStorageKey(userId: string | undefined): string | null {
  return userId ? `${PENDING_PREFERENCES_STORAGE_KEY_PREFIX}.${userId}` : null;
}

function readStoredPendingPatch(storageKey: string | null): Record<string, unknown> {
  if (!storageKey) return {};
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      localStorage.removeItem(storageKey);
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    localStorage.removeItem(storageKey);
    return {};
  }
}

function writeStoredPendingPatch(storageKey: string | null, patch: Record<string, unknown>) {
  if (!storageKey) return;
  if (typeof localStorage === "undefined") return;
  try {
    if (Object.keys(patch).length === 0) {
      localStorage.removeItem(storageKey);
      return;
    }
    localStorage.setItem(storageKey, JSON.stringify(patch));
  } catch {
    // Best-effort only: the in-memory buffer still retries while mounted.
  }
}

function mergeStoredPendingPatch(storageKey: string | null, patch: Record<string, unknown>) {
  if (Object.keys(patch).length === 0) return;
  writeStoredPendingPatch(storageKey, { ...readStoredPendingPatch(storageKey), ...patch });
}

function removeStoredPendingPatch(storageKey: string | null, patch: Record<string, unknown>) {
  const storedPatch = readStoredPendingPatch(storageKey);
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (key in storedPatch && storedValueMatches(storedPatch[key], value)) {
      delete storedPatch[key];
      changed = true;
    }
  }
  if (changed) {
    writeStoredPendingPatch(storageKey, storedPatch);
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
interface PreferenceBufferOptions {
  onPersistedPatch?: (patch: Record<string, unknown>) => void;
}

export function usePreferenceBuffer(options: PreferenceBufferOptions = {}) {
  const { isLoaded, isSignedIn, user } = useUser();
  const storageKey = pendingPreferenceStorageKey(isLoaded && isSignedIn ? user?.id : undefined);
  const upsert = useMutation(api.preferences.mutations.upsertPreferences);
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flushRef = useRef<() => void>(() => {});
  const onPersistedPatchRef = useRef(options.onPersistedPatch);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const restoredStoredPatch = useRef(false);
  const activeStorageKey = useRef<string | null>(storageKey);
  const latestStorageKey = useRef<string | null>(storageKey);

  useLayoutEffect(() => {
    latestStorageKey.current = storageKey;
  }, [storageKey]);

  const scheduleRetry = useCallback(() => {
    if (!mounted.current) return;
    clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => flushRef.current(), 1_000);
  }, []);

  const flush = useCallback(() => {
    const flushStorageKey = storageKey;
    if (latestStorageKey.current !== flushStorageKey) return;
    if (inFlight.current) return;
    const patch = pending.current;
    if (Object.keys(patch).length === 0) return;
    mergeStoredPendingPatch(flushStorageKey, patch);
    pending.current = {};
    inFlight.current = true;
    void Promise.resolve(upsert(patch as Parameters<typeof upsert>[0]))
      .then(() => {
        inFlight.current = false;
        removeStoredPendingPatch(flushStorageKey, patch);
        if (latestStorageKey.current !== flushStorageKey) {
          if (mounted.current && Object.keys(pending.current).length > 0) {
            flushRef.current();
          }
          return;
        }
        onPersistedPatchRef.current?.(patch);
        if (Object.keys(pending.current).length > 0) {
          flushRef.current();
        }
      })
      .catch(() => {
        inFlight.current = false;
        if (latestStorageKey.current !== flushStorageKey) {
          mergeStoredPendingPatch(flushStorageKey, patch);
          if (mounted.current && Object.keys(pending.current).length > 0) {
            flushRef.current();
          }
          return;
        }
        pending.current = { ...patch, ...pending.current };
        mergeStoredPendingPatch(flushStorageKey, pending.current);
        if (!mounted.current) return;
        scheduleRetry();
      });
  }, [scheduleRetry, storageKey, upsert]);

  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  useEffect(() => {
    onPersistedPatchRef.current = options.onPersistedPatch;
  }, [options.onPersistedPatch]);

  /** Debounced (500ms) — merges concurrent patches. Best for sliders/text. */
  const updatePreference = useMemo(
    () => (patch: Record<string, unknown>) => {
      pending.current = { ...pending.current, ...patch };
      mergeStoredPendingPatch(storageKey, pending.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 500);
    },
    [flush, storageKey],
  );

  /** Immediate — fires right away, also flushes any pending debounced patch.
   *  Best for selects/dropdowns where the user expects instant UI response. */
  const updatePreferenceImmediate = useCallback(
    (patch: Record<string, unknown>) => {
      clearTimeout(timer.current);
      pending.current = { ...pending.current, ...patch };
      mergeStoredPendingPatch(storageKey, pending.current);
      flush();
    },
    [flush, storageKey],
  );

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(PENDING_PREFERENCES_STORAGE_KEY_PREFIX);
    }
    if (activeStorageKey.current !== storageKey) {
      clearTimeout(timer.current);
      clearTimeout(retryTimer.current);
      pending.current = {};
      restoredStoredPatch.current = false;
      activeStorageKey.current = storageKey;
    }
    if (!restoredStoredPatch.current) {
      restoredStoredPatch.current = true;
      const storedPatch = readStoredPendingPatch(storageKey);
      if (Object.keys(storedPatch).length > 0) {
        pending.current = { ...storedPatch, ...pending.current };
        flush();
      }
    }
  }, [flush, storageKey]);

  useEffect(() => {
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
      window.removeEventListener("pagehide", flushPending);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [flush]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      clearTimeout(retryTimer.current);
      flushRef.current();
    };
  }, []);

  return { updatePreference, updatePreferenceImmediate };
}
