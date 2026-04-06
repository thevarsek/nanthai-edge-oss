// components/chat/AudioRecordingOverlay.tsx — Recording UI overlay for MessageInput.
// Shows waveform bars, elapsed timer, live transcript, and stop/cancel controls.

import { Mic, X, Send } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  elapsedMs: number;
  levels: number[];
  interimTranscript: string;
  onStop: () => void;
  onCancel: () => void;
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function AudioRecordingOverlay({ elapsedMs, levels, interimTranscript, onStop, onCancel }: Props) {
  const { t } = useTranslation();
  return (
    <div className="border-t border-border/30 bg-background px-4 py-3">
      {/* Live transcript */}
      {interimTranscript && (
        <p className="text-xs text-muted mb-2 truncate max-w-full italic">
          {interimTranscript}
        </p>
      )}

      <div className="flex items-center gap-3">
        {/* Cancel button */}
        <button
          onClick={onCancel}
          className="p-2.5 rounded-xl text-muted hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
          title={t("audio_cancel_recording")}
        >
          <X size={18} />
        </button>

        {/* Waveform + timer */}
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <Mic size={16} className="text-red-400 shrink-0 animate-pulse" />

          {/* Waveform bars */}
          <div className="flex items-center gap-[2px] h-8 flex-1 min-w-0">
            {levels.map((level, i) => (
              <div
                key={i}
                className="flex-1 rounded-full bg-red-400/80 transition-[height] duration-100"
                style={{
                  height: `${Math.max(4, level * 32)}px`,
                  minWidth: 2,
                  maxWidth: 6,
                }}
              />
            ))}
          </div>

          <span className="text-xs text-muted tabular-nums shrink-0">
            {formatTime(elapsedMs)}
          </span>
        </div>

        {/* Send (stop) button */}
        <button
          onClick={onStop}
          className="p-2.5 rounded-xl bg-primary text-white hover:opacity-90 transition-opacity shrink-0"
          title={t("audio_record_voice")}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
