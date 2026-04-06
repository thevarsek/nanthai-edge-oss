import { useSharedData } from "@/hooks/useSharedData";

/**
 * Returns the user's Pro status from the shared data context.
 * `isPro` is `false` while the data is still loading.
 */
export function useProGate(): { isPro: boolean } {
  const { proStatus } = useSharedData();
  return { isPro: proStatus?.isPro ?? false };
}
