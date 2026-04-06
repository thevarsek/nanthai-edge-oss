// components/chat/ResearchProgressPanel.tsx
// Full overlay on assistant message bubbles during active search sessions.
// Mirrors iOS ResearchProgressView: pulsing dot, mode label, elapsed time,
// phase label, progress bar, complexity, cancel button.

import { useEffect, useState } from "react";
import { FileText, Globe, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SearchSession } from "@/hooks/useSearchSessions";
import { phaseLabel, isSessionActive } from "@/hooks/useSearchSessions";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(startedAt: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── ResearchProgressPanel ────────────────────────────────────────────────────

interface ResearchProgressPanelProps {
  session: SearchSession;
  onCancel: () => void;
}

export function ResearchProgressPanel({ session, onCancel }: ResearchProgressPanelProps) {
  const { t } = useTranslation();
  const [now, setNow] = useState<number>(() => Date.now());
  const active = isSessionActive(session.status);

  // Tick elapsed timer every second while active
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, session._id]);

  const isPaper = session.mode === "paper";
  const modeLabel = isPaper ? t("research_paper") : t("web_search");
  const ModeIcon = isPaper ? FileText : Globe;

  // Mode color classes
  const dotColor = isPaper ? "bg-orange-400" : "bg-blue-400";
  const textColor = isPaper ? "text-orange-400" : "text-blue-400";
  const barColor = isPaper ? "bg-orange-400" : "bg-blue-400";

  return (
    <div className="rounded-xl border border-border/20 bg-surface-2/50 backdrop-blur-sm p-3 mt-2 space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Top row: mode badge + elapsed */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${dotColor} animate-pulse`} />
          <ModeIcon size={13} className={textColor} />
          <span className={`text-xs font-bold ${textColor}`}>{modeLabel}</span>
        </div>
        <span className="text-xs text-muted tabular-nums">
          {formatElapsed(session.startedAt, now)}
        </span>
      </div>

      {/* Phase label */}
      <p className="text-sm text-foreground">
        {phaseLabel(session.status)}
      </p>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-surface-3/50 overflow-hidden">
          <div
            className={`h-full rounded-full ${barColor} transition-all duration-500 ease-out`}
            style={{ width: `${Math.min(100, Math.max(0, session.progress))}%` }}
          />
        </div>
        <p className="text-[11px] text-muted tabular-nums">
          {t("percent_complete", { var1: session.progress })}
        </p>
      </div>

      {/* Bottom row: complexity + cancel */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted">
          {t("complexity_label", { var1: session.complexity })}
        </span>

        {active && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1 text-xs font-medium text-red-400/85 hover:text-red-400 transition-colors"
          >
            <XCircle size={13} />
            {t("cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
