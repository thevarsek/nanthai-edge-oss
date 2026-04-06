import { useEffect, useState } from "react";

export function useOptimistic<T>(serverValue: T): [T, (v: T) => void] {
  const [local, setLocal] = useState(serverValue);
  useEffect(() => { setLocal(serverValue); }, [serverValue]);
  return [local, setLocal];
}

export function shortModelName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

export const VOICE_OPTIONS = [
  "alloy", "ash", "ballad", "coral", "echo",
  "fable", "nova", "onyx", "sage", "shimmer", "verse",
];
