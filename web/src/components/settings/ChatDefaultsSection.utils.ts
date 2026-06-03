import { useCallback, useEffect, useRef, useState } from "react";

export function useOptimistic<T>(serverValue: T): [T, (v: T) => void] {
  const [local, setLocal] = useState(serverValue);
  const localRef = useRef(local);
  const serverValueRef = useRef(serverValue);
  const hasPendingLocalEditRef = useRef(false);

  useEffect(() => {
    localRef.current = local;
  }, [local]);

  useEffect(() => {
    serverValueRef.current = serverValue;
    if (hasPendingLocalEditRef.current) {
      if (Object.is(serverValue, localRef.current)) {
        hasPendingLocalEditRef.current = false;
      }
      return;
    }
    const timer = window.setTimeout(() => setLocal(serverValue), 0);
    return () => window.clearTimeout(timer);
  }, [serverValue]);

  const setOptimistic = useCallback((value: T) => {
    if (Object.is(value, localRef.current)) {
      if (Object.is(value, serverValueRef.current)) {
        hasPendingLocalEditRef.current = false;
      }
      return;
    }
    hasPendingLocalEditRef.current = !Object.is(value, serverValueRef.current);
    localRef.current = value;
    setLocal(value);
  }, []);

  return [local, setOptimistic];
}

export function shortModelName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

export const VOICE_OPTIONS = [
  "alloy", "ash", "ballad", "coral", "echo",
  "fable", "nova", "onyx", "sage", "shimmer", "verse",
];
