// hooks/useAudioPlayback.ts — Manages audio playback, TTS generation requests, and polling.
// Shared by AudioMessageBubble (inline player) and assistant message "play audio" button.

import { useCallback, useRef, useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export interface PlaybackState {
  /** Message currently being played (or loading). */
  activeMessageId: Id<"messages"> | null;
  isPlaying: boolean;
  isLoading: boolean;
  /** 0–1 progress through the track. */
  progress: number;
  /** Current playback speed (1, 1.5, 2). */
  speed: number;
  /** Current elapsed time in seconds. */
  currentTime: number;
  /** Total duration in seconds (from audio element or message metadata). */
  duration: number;
}

const SPEEDS = [1, 1.5, 2] as const;

export function useAudioPlayback(defaultSpeed = 1) {
  const [activeMessageId, setActiveMessageId] = useState<Id<"messages"> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(defaultSpeed);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pollCountRef = useRef(0);

  const requestAudioGeneration = useMutation(api.chat.mutations.requestAudioGeneration);
  // Reactive query — re-runs when the message's audioStorageId changes on the backend.
  const audioUrl = useQuery(
    api.chat.queries.getMessageAudioUrl,
    activeMessageId ? { messageId: activeMessageId } : "skip",
  ) as string | null | undefined;

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }
    setIsPlaying(false);
    setProgress(0);
    setCurrentTime(0);
    setDuration(0);
    pollCountRef.current = 0;
  }, []);

  // Progress animation loop
  const startProgressLoop = useCallback(() => {
    const tick = () => {
      const a = audioRef.current;
      if (!a || a.paused) { rafRef.current = null; return; }
      setCurrentTime(a.currentTime);
      setDuration(a.duration || 0);
      setProgress(a.duration ? a.currentTime / a.duration : 0);
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const playUrl = useCallback(
    (url: string, messageId: Id<"messages">) => {
      cleanup();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.playbackRate = speed;
      audio.addEventListener("ended", () => {
        setIsPlaying(false);
        setProgress(1);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      });
      audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
      audio.addEventListener("error", () => {
        setIsPlaying(false);
        setIsLoading(false);
      });
      setActiveMessageId(messageId);
      setIsLoading(false);
      setIsPlaying(true);
      void audio.play().then(startProgressLoop);
    },
    [cleanup, speed, startProgressLoop],
  );

  // When audioUrl becomes available from the reactive query, play it.
  useEffect(() => {
    if (!audioUrl || !activeMessageId || !isLoading) return;
    const timer = window.setTimeout(() => playUrl(audioUrl, activeMessageId), 0);
    return () => window.clearTimeout(timer);
  }, [audioUrl, activeMessageId, isLoading, playUrl]);

  /** Start playback for a message. If no audio exists, requests TTS generation. */
  const play = useCallback(
    async (messageId: Id<"messages">, existingAudioStorageId?: Id<"_storage">) => {
      // Toggle off if same message
      if (activeMessageId === messageId && isPlaying) {
        audioRef.current?.pause();
        setIsPlaying(false);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        return;
      }
      // Resume if paused on same message
      if (activeMessageId === messageId && audioRef.current && !isPlaying) {
        void audioRef.current.play().then(startProgressLoop);
        setIsPlaying(true);
        return;
      }

      cleanup();
      setActiveMessageId(messageId);
      setIsLoading(true);

      if (existingAudioStorageId) {
        // Audio already generated — the reactive query will provide the URL.
        // It may already be available if we subscribed.
        return;
      }

      // Request TTS generation — backend schedules it, then the reactive
      // query on getMessageAudioUrl will fire when audioStorageId is patched.
      try {
        await requestAudioGeneration({ messageId });
      } catch {
        setIsLoading(false);
        setActiveMessageId(null);
      }
    },
    [activeMessageId, isPlaying, cleanup, startProgressLoop, requestAudioGeneration],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const stop = useCallback(() => {
    cleanup();
    setActiveMessageId(null);
    setIsLoading(false);
  }, [cleanup]);

  const cycleSpeed = useCallback(() => {
    setSpeed((prev) => {
      const idx = SPEEDS.indexOf(prev as typeof SPEEDS[number]);
      const next = SPEEDS[(idx + 1) % SPEEDS.length];
      if (audioRef.current) audioRef.current.playbackRate = next;
      return next;
    });
  }, []);

  const seek = useCallback((fraction: number) => {
    const a = audioRef.current;
    if (!a || !a.duration) return;
    a.currentTime = fraction * a.duration;
    setProgress(fraction);
    setCurrentTime(a.currentTime);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { cleanup(); setActiveMessageId(null); }, [cleanup]);

  const state: PlaybackState = {
    activeMessageId, isPlaying, isLoading, progress, speed, currentTime, duration,
  };

  return {
    state,
    play, pause, stop, cycleSpeed, seek,
  };
}
