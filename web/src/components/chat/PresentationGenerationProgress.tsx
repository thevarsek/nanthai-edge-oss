import { AlertCircle, CheckCircle2, Presentation } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PresentationGenerationProgress as Progress } from "@/hooks/useChat";

const PHASE_KEYS: Record<Progress["phase"], string> = {
  queued: "presentation_progress_queued",
  planning: "presentation_progress_planning",
  repairing_plan: "presentation_progress_repairing_plan",
  generating: "presentation_progress_generating",
  repairing_generation: "presentation_progress_repairing_generation",
  exporting: "presentation_progress_exporting",
  complete: "presentation_progress_complete",
  failed: "presentation_progress_failed",
};

export function PresentationGenerationProgress({ progress }: { progress: Progress }) {
  const { t } = useTranslation();
  const failed = progress.phase === "failed";
  const complete = progress.phase === "complete";
  const Icon = failed ? AlertCircle : complete ? CheckCircle2 : Presentation;

  return (
    <div className="mt-2 rounded-xl border border-border/40 bg-surface-2/60 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Icon size={15} className={failed ? "text-destructive" : "text-primary"} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{progress.title}</p>
          <p className="text-[11px] text-muted">
            {t(PHASE_KEYS[progress.phase], { count: progress.slideCount })}
          </p>
        </div>
        <span className="text-[11px] tabular-nums text-muted">
          {Math.round(progress.progress * 100)}%
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${failed ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${Math.round(progress.progress * 100)}%` }}
        />
      </div>
      {failed && progress.error && (
        <p className="mt-2 text-[11px] text-destructive">{progress.error}</p>
      )}
    </div>
  );
}
