import { useState } from "react";
import { MessagesSquare, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UseCollaborationReturn } from "@/hooks/useCollaboration";
import { ChatActivityButton, ChatActivityPanel } from "./ChatActivityPanel";

interface CollaborationControlProps {
  collaboration: UseCollaborationReturn;
  autonomousActive: boolean;
}

function exchangeStatusKey(
  status?: string,
  terminalReason?: string,
): string | null {
  if (!status) return null;
  if (
    terminalReason === "scheduler_output_truncated" ||
    terminalReason === "scheduler_invalid_response"
  ) {
    return "collaboration_scheduler_retry";
  }
  if (status === "queued" || status === "scheduling") {
    return "collaboration_choosing_speakers";
  }
  if (status === "dispatching") return "collaboration_starting_speakers";
  if (status === "waiting") return "collaboration_waiting_for_wave";
  if (status === "silent") return "collaboration_floor_returned";
  if (status === "limit_reached") return "collaboration_limit_reached";
  if (status === "stopped") return "collaboration_stopped";
  if (status === "failed") return "collaboration_failed";
  if (status === "completed") return "collaboration_completed";
  return null;
}

export function CollaborationControl({
  collaboration,
  autonomousActive,
}: CollaborationControlProps) {
  const { t } = useTranslation();
  const [dismissedExchangeId, setDismissedExchangeId] = useState<string | null>(null);
  const [mountedAt] = useState(() => Date.now());
  const exchange = collaboration.state?.exchange;
  const terminal = Boolean(exchange && !collaboration.isActive);
  const recentTerminal = Boolean(
    exchange?.completedAt && (
      exchange.completedAt >= mountedAt || mountedAt - exchange.completedAt <= 15_000
    ),
  );
  if (
    autonomousActive ||
    collaboration.behavior !== "collaboration" ||
    !exchange ||
    (terminal && (!recentTerminal || dismissedExchangeId === String(exchange.id)))
  ) {
    return null;
  }

  const activeNames = exchange.activeSpeakers.map((speaker) => speaker.displayName);
  const statusKey = exchangeStatusKey(exchange.status, exchange.terminalReason);
  const statusText = activeNames.length > 0
    ? t("collaboration_speakers_active", { names: activeNames.join(", ") })
    : statusKey
      ? t(statusKey)
      : t("collaboration_waiting_for_wave");

  return (
    <ChatActivityPanel>
      <div className="space-y-2" role="status">
        <div className="flex min-w-0 items-center gap-2">
          <span className="relative inline-flex h-2 w-2 shrink-0">
            {collaboration.isActive && (
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/50" />
            )}
            <span className={`relative h-2 w-2 rounded-full ${collaboration.isActive ? "bg-primary" : "bg-muted"}`} />
          </span>
          <MessagesSquare size={14} className="shrink-0 text-primary" />
          <span className="text-xs font-bold tracking-wide text-primary">
            {t("collaboration_label")}
          </span>
          <span className="font-mono text-xs tabular-nums text-muted">
            {t("collaboration_wave", {
              current: exchange.currentWave,
              max: exchange.maxWaves,
            })}
          </span>
        </div>
        <p className="text-sm text-foreground">{statusText}</p>
        {exchange.pendingInputCount > 0 && (
          <p className="text-xs text-muted">
            {t("collaboration_input_queued", { count: exchange.pendingInputCount })}
          </p>
        )}
        {collaboration.error && (
          <p className="text-xs text-destructive">{collaboration.error}</p>
        )}
        {exchange.error && (
          <p className="text-xs text-destructive">{exchange.error}</p>
        )}
        {terminal && (
          <div className="flex gap-2">
            <ChatActivityButton
              label={t("dismiss")}
              icon={<X size={14} />}
              tone="muted"
              onClick={() => setDismissedExchangeId(String(exchange.id))}
            />
          </div>
        )}
      </div>
    </ChatActivityPanel>
  );
}
