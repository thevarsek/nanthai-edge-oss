// components/chat/VideoGenerationProgress.tsx
// Compact inline progress panel for async video generation jobs.
// Follows the ResearchProgressPanel pattern: pulsing dot, icon, elapsed timer, status text.

import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function statusLabel(status: string, t: (key: string) => string): string {
  switch (status) {
    case "pending":
      return t("video_queued");
    case "in_progress":
      return t("video_generating");
    case "completed":
      return t("video_completed");
    case "failed":
      return t("video_failed");
    default:
      return t("video_generating");
  }
}

// ─── VideoGenerationProgress ──────────────────────────────────────────────────

interface VideoGenerationProgressProps {
  messageId: Id<"messages">;
}

export function VideoGenerationProgress({ messageId }: VideoGenerationProgressProps) {
  const { t } = useTranslation();
  const videoJob = useQuery(api.chat.queries.getVideoJobStatus, { messageId });
  const [now, setNow] = useState<number>(() => Date.now());

  const active = videoJob?.status === "pending" || videoJob?.status === "in_progress";

  // Tick elapsed timer every second while active
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);

  // Don't render if no video job or already completed (video URLs will show instead)
  if (!videoJob || videoJob.status === "completed") return null;

  const isFailed = videoJob.status === "failed";
  const dotColor = isFailed ? "bg-red-400" : "bg-purple-400";
  const textColor = isFailed ? "text-red-400" : "text-purple-400";

  return (
    <div className="rounded-xl border border-border/20 bg-surface-2/50 backdrop-blur-sm p-3 mt-2 space-y-2 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Top row: mode badge + elapsed */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${dotColor} ${active ? "animate-pulse" : ""}`} />
          <Video size={13} className={textColor} />
          <span className={`text-xs font-bold ${textColor}`}>{t("video_generation")}</span>
        </div>
        <span className="text-xs text-muted tabular-nums">
          {formatElapsed(videoJob.createdAt, now)}
        </span>
      </div>

      {/* Status text */}
      <p className="text-sm text-foreground">
        {statusLabel(videoJob.status, t)}
      </p>

      {/* Error detail */}
      {isFailed && videoJob.error && (
        <p className="text-xs text-destructive italic">{videoJob.error}</p>
      )}
    </div>
  );
}
