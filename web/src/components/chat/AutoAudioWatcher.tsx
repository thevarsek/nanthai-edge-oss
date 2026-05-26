// components/chat/AutoAudioWatcher.tsx
// Detects when auto-audio TTS completes on an assistant message and auto-plays it.
// Backend auto-schedules TTS when: user sent audio + auto-audio enabled.
// This component watches for audioStorageId appearing on assistant messages
// whose parent is an audio-based user message, then triggers playback.

import { useEffect, useRef } from "react";
import { useAudioPlaybackContext } from "./AudioPlaybackContext.hook";
import type { Message } from "@/hooks/useChat";
import type { Id } from "@convex/_generated/dataModel";

const LYRIA_MODEL_IDS = new Set([
  "google/lyria-3-clip-preview",
  "google/lyria-3-pro-preview",
]);

interface Props {
  messages: Message[];
  isLoading?: boolean;
}

/** Returns true if the message is a user message with recorded audio. */
function isAudioUserMessage(m: Message): boolean {
  return m.role === "user" && !!m.audioStorageId;
}

/** Lyria messages carry their own inline audio — don't auto-play via TTS path. */
function isLyriaMusic(m: Message): boolean {
  return !!m.audioStorageId && !!m.modelId && LYRIA_MODEL_IDS.has(m.modelId);
}

function directAudioParent(message: Message, byId: Map<string, Message>): Message | undefined {
  for (const parentId of message.parentMessageIds ?? []) {
    const parent = byId.get(parentId as string);
    if (parent?.role === "user") return parent;
  }
  return undefined;
}

/**
 * Watches for assistant messages whose audioStorageId transitions from
 * absent → present, and auto-plays them if their preceding user message
 * was an audio message. Renders nothing.
 */
export function AutoAudioWatcher({ messages, isLoading = false }: Props) {
  const audio = useAudioPlaybackContext();
  // Track which audioStorageIds we've already seen to detect new arrivals.
  const seenAudioRef = useRef<Set<string>>(new Set());
  const pendingAudioRef = useRef<Set<string>>(new Set());
  // Skip auto-play on initial mount to avoid replaying old audio.
  const mountedRef = useRef(false);

  useEffect(() => {
    if (isLoading) return;

    if (!mountedRef.current) {
      // Seed the seen set with all existing audioStorageIds on mount.
      for (const m of messages) {
        if (m.audioStorageId) seenAudioRef.current.add(m._id);
      }
      mountedRef.current = true;
      return;
    }

    const byId = new Map(messages.map((message) => [message._id as string, message]));

    // Find assistant messages that just got audioStorageId.
    for (const m of messages) {
      if (
        m.role !== "assistant" ||
        !m.audioStorageId ||
        m.status !== "completed" ||
        seenAudioRef.current.has(m._id) ||
        isLyriaMusic(m)
      ) continue;

      // Check the actual parent first; fall back for legacy messages that have no parent ids.
      const idx = messages.indexOf(m);
      const prevUser = (m.parentMessageIds?.length ?? 0) > 0
        ? directAudioParent(m, byId)
        : messages.slice(0, idx).reverse().find((pm) => pm.role === "user");
      if (!prevUser || !isAudioUserMessage(prevUser)) {
        seenAudioRef.current.add(m._id);
        continue;
      }

      // Don't interrupt an already-playing message.
      if (audio.state.isPlaying || audio.state.isLoading) {
        pendingAudioRef.current.add(m._id);
        continue;
      }

      // Auto-play this newly-generated TTS audio.
      pendingAudioRef.current.delete(m._id);
      void audio.play(m._id, m.audioStorageId as Id<"_storage">)
        .then(() => {
          seenAudioRef.current.add(m._id);
        })
        .catch(() => {
          pendingAudioRef.current.add(m._id);
        });
      break; // Only auto-play one at a time.
    }
  }, [messages, audio, isLoading]);

  return null;
}
