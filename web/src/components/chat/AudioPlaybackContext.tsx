// components/chat/AudioPlaybackContext.tsx
// React context to share audio playback state/actions across the message list.
// Avoids prop-drilling through ChatPage → MessageBubble → AudioMessageBubble.

import type { ReactNode } from "react";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { AudioPlaybackContext } from "./AudioPlaybackContext.hook";

/**
 * Provides audio playback controls to the message list.
 * Accepts `defaultAudioSpeed` as a prop (injected by ChatPage from prefs)
 * so this provider doesn't subscribe to SharedData and avoids re-rendering
 * the entire message tree on unrelated pref/persona/favorite changes.
 */
export function AudioPlaybackProvider({
  defaultAudioSpeed = 1,
  children,
}: {
  defaultAudioSpeed?: number;
  children: ReactNode;
}) {
  const playback = useAudioPlayback(defaultAudioSpeed);
  return <AudioPlaybackContext.Provider value={playback}>{children}</AudioPlaybackContext.Provider>;
}
