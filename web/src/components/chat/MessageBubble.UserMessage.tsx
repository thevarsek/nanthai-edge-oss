// components/chat/MessageBubble.UserMessage.tsx
// User message bubble — matches iOS MessageBubble.swift + UserMessageActionBar.

import { memo, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Copy, CheckCircle, Volume2 } from "lucide-react";
import type { Message } from "@/hooks/useChat";
import { AudioMessageBubble } from "./AudioMessageBubble";
import { useAudioPlaybackContext } from "./AudioPlaybackContext.hook";
import { MessageAttachments } from "./MessageAttachments";

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserMessageProps {
  message: Message;
}

// ─── Timestamp helper ─────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// ─── User message ─────────────────────────────────────────────────────────────

export const UserMessage = memo(function UserMessage({ message }: UserMessageProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const audio = useAudioPlaybackContext();

  const hasAudio = !!message.audioStorageId;
  const handlePlayAudio = useCallback(
    () => void audio.play(message._id, message.audioStorageId),
    [audio, message._id, message.audioStorageId],
  );

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [message.content]);

  return (
    <div className="flex flex-col items-end gap-1">
      {/* Bubble — iOS: RoundedRectangle(cornerRadius: 12), horizontal(14), vertical(10) */}
      {(message.content || hasAudio) && (
        <div className="max-w-[75%] rounded-xl bg-primary px-3.5 py-2.5">
        {hasAudio && (
          <div className="mb-2">
            <AudioMessageBubble
              messageId={message._id} durationMs={message.audioDurationMs}
              role="user" playbackState={audio.state} onPlay={handlePlayAudio}
              onPause={audio.pause} onSeek={audio.seek} onCycleSpeed={audio.cycleSpeed}
            />
          </div>
        )}
        {/* iOS renders user text as plain Text() — no markdown */}
        <p className="text-white text-sm leading-relaxed whitespace-pre-wrap break-words">
          {message.content}
        </p>
        </div>
      )}

      {message.attachments && message.attachments.length > 0 && (
        <MessageAttachments
          attachments={message.attachments}
          messageId={message._id}
          isUser
        />
      )}

      {/* Action bar — iOS: right-aligned (Spacer on left), below bubble */}
      <div className="flex items-center gap-0.5 mr-1">
        {hasAudio && (
          <button
            onClick={handlePlayAudio}
            className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
            title={t("play_audio")}
          >
            <Volume2 size={13} />
          </button>
        )}
        {/* Copy */}
        <button
          onClick={handleCopy}
          className="p-1.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
            title={t("copy")}
        >
          {copied ? <CheckCircle size={13} /> : <Copy size={13} />}
        </button>
      </div>

      {/* Timestamp */}
      <p className="text-[10px] text-muted mr-1 font-mono">
        {formatTimestamp(message._creationTime)}
      </p>
    </div>
  );
});
