// components/chat/AudioMessageBubble.tsx — Inline waveform player for voice messages.
// Used for both user-recorded audio and assistant TTS audio.

import { useCallback } from "react";
import { Play, Pause, Loader2 } from "lucide-react";
import type { PlaybackState } from "@/hooks/useAudioPlayback";
import type { Id } from "@convex/_generated/dataModel";

interface Props {
  messageId: Id<"messages">;
  /** Duration in milliseconds from message metadata. */
  durationMs?: number;
  /** Whether TTS is currently being generated server-side. */
  isGenerating?: boolean;
  /** Role determines bubble color (user = primary, assistant = gray). */
  role: "user" | "assistant";
  /** Transcript text displayed below the waveform. */
  transcript?: string;
  /** Global playback state from useAudioPlayback. */
  playbackState: PlaybackState;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (fraction: number) => void;
  onCycleSpeed: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioMessageBubble({
  messageId, durationMs, isGenerating, role, transcript,
  playbackState, onPlay, onPause, onSeek, onCycleSpeed,
}: Props) {
  const isActive = playbackState.activeMessageId === messageId;
  const isPlaying = isActive && playbackState.isPlaying;
  const isLoading = isActive && playbackState.isLoading;
  const progress = isActive ? playbackState.progress : 0;
  const currentTime = isActive ? playbackState.currentTime : 0;
  const totalDuration = isActive && playbackState.duration > 0
    ? playbackState.duration
    : (durationMs ? durationMs / 1000 : 0);
  const speed = isActive ? playbackState.speed : 1;

  const isUser = role === "user";
  const barColor = isUser ? "bg-white/60" : "bg-primary/60";
  const barActiveColor = isUser ? "bg-white" : "bg-primary";

  const handleBarClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      onSeek(fraction);
    },
    [onSeek],
  );

  return (
    <div className="flex flex-col gap-1.5 min-w-[200px] max-w-[320px]">
      <div className="flex items-center gap-2.5">
        {/* Play / Pause / Loading button */}
        <button
          onClick={isGenerating || isLoading ? undefined : isPlaying ? onPause : onPlay}
          disabled={isGenerating || isLoading}
          className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
            isUser
              ? "bg-white/20 hover:bg-white/30 text-white"
              : "bg-primary/20 hover:bg-primary/30 text-primary"
          } disabled:opacity-50`}
          title={isGenerating ? "Generating audio..." : isPlaying ? "Pause" : "Play"}
        >
          {isGenerating || isLoading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : isPlaying ? (
            <Pause size={16} />
          ) : (
            <Play size={16} className="ml-0.5" />
          )}
        </button>

        {/* Waveform / progress bar */}
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div
            className="relative h-6 flex items-center cursor-pointer"
            onClick={handleBarClick}
          >
            {/* Background bar */}
            <div className={`absolute inset-y-2 left-0 right-0 rounded-full ${barColor}`} />
            {/* Progress fill */}
            <div
              className={`absolute inset-y-2 left-0 rounded-full ${barActiveColor} transition-[width] duration-75`}
              style={{ width: `${progress * 100}%` }}
            />
          </div>

          {/* Time + speed */}
          <div className="flex items-center justify-between text-[10px] opacity-70">
            <span className="tabular-nums">
              {isActive ? formatDuration(currentTime) : "0:00"} / {formatDuration(totalDuration)}
            </span>
            {isActive && (
              <button
                onClick={(e) => { e.stopPropagation(); onCycleSpeed(); }}
                className="px-1 rounded hover:opacity-80 font-medium"
              >
                {speed}x
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Transcript */}
      {transcript && (
        <p className="text-xs opacity-70 leading-relaxed">{transcript}</p>
      )}
    </div>
  );
}
