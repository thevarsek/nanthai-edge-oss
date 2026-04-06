import { createContext, useContext } from "react";
import type { PlaybackState } from "@/hooks/useAudioPlayback";
import type { Id } from "@convex/_generated/dataModel";

export interface AudioPlaybackContextValue {
  state: PlaybackState;
  play: (messageId: Id<"messages">, existingAudioStorageId?: Id<"_storage">) => Promise<void>;
  pause: () => void;
  stop: () => void;
  cycleSpeed: () => void;
  seek: (fraction: number) => void;
}

export const AudioPlaybackContext = createContext<AudioPlaybackContextValue | null>(null);

export function useAudioPlaybackContext(): AudioPlaybackContextValue {
  const ctx = useContext(AudioPlaybackContext);
  if (!ctx) throw new Error("useAudioPlaybackContext must be used within AudioPlaybackProvider");
  return ctx;
}
