import { useCallback, useEffect, useRef, useState } from "react";

export type OpenRouterPreferenceKey = "showBalanceInChat" | "showAdvancedStats";

type PendingPreference = {
  requestId: number;
  value: boolean;
  serverVersion: number;
};

type SaveOpenRouterPreference = (
  prefs: Partial<Record<OpenRouterPreferenceKey, boolean>>,
) => Promise<unknown>;

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
      return serverCaughtUp ? null : current;
    });
  }, [serverValue]);

  const setValue = useCallback(async (nextValue: boolean) => {
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    setErrorMessage(null);
    setPending({
      requestId,
      value: nextValue,
      serverVersion: serverVersion.current,
    });

    try {
      await savePreference({ [key]: nextValue });
      setPending((current) => {
        if (current?.requestId !== requestId) return current;
        return lastServerValue.current === nextValue ? null : current;
      });
    } catch (error) {
      if (requestSeq.current !== requestId) return;
      setPending((current) => current?.requestId === requestId ? null : current);
      setErrorMessage(error instanceof Error ? error.message : fallbackErrorMessage);
    }
  }, [fallbackErrorMessage, key, savePreference, setErrorMessage]);

  return {
    value: pending?.value ?? serverValue,
    setValue,
  };
}
