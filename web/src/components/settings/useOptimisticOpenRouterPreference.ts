import { useCallback, useEffect, useRef, useState } from "react";
import { captureSettingChanged } from "@/lib/featureAnalytics";

export type OpenRouterPreferenceKey = "showBalanceInChat" | "showAdvancedStats";
export const OPENROUTER_PREFERENCE_STALE_ECHO_GUARD_MS = 5_000;

type PendingPreference = {
  requestId: number;
  value: boolean;
  serverVersion: number;
};

type SaveOpenRouterPreference = (
  prefs: Partial<Record<OpenRouterPreferenceKey, boolean>>,
) => Promise<unknown>;

function captureOpenRouterPreferenceChanged(key: OpenRouterPreferenceKey) {
  captureSettingChanged({
    setting_key: key,
    setting_area: "settings",
    value_type: "boolean",
  });
}

export function useOptimisticOpenRouterPreference(
  key: OpenRouterPreferenceKey,
  serverValue: boolean,
  savePreference: SaveOpenRouterPreference,
  setErrorMessage: (message: string | null) => void,
  fallbackErrorMessage: string,
) {
  const [pending, setPending] = useState<PendingPreference | null>(null);
  const requestSeq = useRef(0);
  const serverVersion = useRef(0);
  const lastServerValue = useRef<boolean | null>(null);
  const latestDesiredValue = useRef<boolean | null>(null);
  const latestDesiredResetTimeout = useRef<number | null>(null);
  const latestDesiredResetValue = useRef<boolean | null>(null);

  const clearLatestDesiredResetTimer = useCallback(() => {
    if (latestDesiredResetTimeout.current == null) return;
    window.clearTimeout(latestDesiredResetTimeout.current);
    latestDesiredResetTimeout.current = null;
    latestDesiredResetValue.current = null;
  }, []);

  const scheduleLatestDesiredReset = useCallback((value: boolean) => {
    if (
      latestDesiredResetTimeout.current != null &&
      latestDesiredResetValue.current === value
    ) {
      return;
    }
    clearLatestDesiredResetTimer();
    latestDesiredResetValue.current = value;
    latestDesiredResetTimeout.current = window.setTimeout(() => {
      if (latestDesiredValue.current === value) {
        latestDesiredValue.current = null;
      }
      latestDesiredResetTimeout.current = null;
      latestDesiredResetValue.current = null;
    }, OPENROUTER_PREFERENCE_STALE_ECHO_GUARD_MS);
  }, [clearLatestDesiredResetTimer]);

  useEffect(() => () => clearLatestDesiredResetTimer(), [clearLatestDesiredResetTimer]);

  useEffect(() => {
    if (lastServerValue.current !== serverValue) {
      lastServerValue.current = serverValue;
      serverVersion.current += 1;
    }

    setPending((current) => {
      if (!current) return current;
      const serverCaughtUp =
        current.value === serverValue &&
        serverVersion.current > current.serverVersion;
      if (serverCaughtUp) {
        scheduleLatestDesiredReset(current.value);
        return null;
      }
      return current;
    });

    if (latestDesiredValue.current === serverValue) {
      scheduleLatestDesiredReset(serverValue);
      return;
    }
    if (latestDesiredValue.current === null) {
      return;
    }

    const intendedValue = latestDesiredValue.current;
    clearLatestDesiredResetTimer();
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setPending({
      requestId,
      value: intendedValue,
      serverVersion: serverVersion.current,
    });
    void savePreference({ [key]: intendedValue })
      .then(() => {
        setPending((current) => {
          if (current?.requestId !== requestId) return current;
          if (lastServerValue.current === intendedValue) {
            scheduleLatestDesiredReset(intendedValue);
            return null;
          }
          return current;
        });
      })
      .catch((error) => {
        if (requestSeq.current !== requestId) return;
        clearLatestDesiredResetTimer();
        latestDesiredValue.current = null;
        setPending((current) => current?.requestId === requestId ? null : current);
        setErrorMessage(error instanceof Error ? error.message : fallbackErrorMessage);
      });
  }, [clearLatestDesiredResetTimer, fallbackErrorMessage, key, savePreference, scheduleLatestDesiredReset, serverValue, setErrorMessage]);

  const setValue = useCallback(async (nextValue: boolean) => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    clearLatestDesiredResetTimer();
    latestDesiredValue.current = nextValue;
    setErrorMessage(null);
    setPending({
      requestId,
      value: nextValue,
      serverVersion: serverVersion.current,
    });

    try {
      await savePreference({ [key]: nextValue });
      captureOpenRouterPreferenceChanged(key);
      setPending((current) => {
        if (current?.requestId !== requestId) return current;
        if (lastServerValue.current === nextValue) {
          scheduleLatestDesiredReset(nextValue);
          return null;
        }
        return current;
      });
    } catch (error) {
      if (requestSeq.current !== requestId) return;
      clearLatestDesiredResetTimer();
      latestDesiredValue.current = null;
      setPending((current) => current?.requestId === requestId ? null : current);
      setErrorMessage(error instanceof Error ? error.message : fallbackErrorMessage);
    }
  }, [clearLatestDesiredResetTimer, fallbackErrorMessage, key, savePreference, scheduleLatestDesiredReset, setErrorMessage]);

  return {
    value: pending?.value ?? serverValue,
    setValue,
  };
}
