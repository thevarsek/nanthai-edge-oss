import { AlertTriangle, Presentation, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PresentationContext } from "@/hooks/useChat";

interface PresentationContextChipProps {
  target: {
    context: PresentationContext;
    label: string;
  };
  onRemove?: () => void;
  writeBlocked?: boolean;
}

export function PresentationContextChip({ target, onRemove, writeBlocked = false }: PresentationContextChipProps) {
  const { t } = useTranslation();
  return (
    <div className="mb-2 space-y-1.5" data-testid="presentation-context-chip">
      <div
        className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2"
      >
        <Presentation size={14} className="shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground">{target.label}</span>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
          aria-label={t("remove_presentation_target")}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {writeBlocked && (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-950 dark:text-amber-200"
          data-testid="artifact-write-guidance"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t("artifact_write_requires_single_participant")}</span>
        </div>
      )}
    </div>
  );
}
