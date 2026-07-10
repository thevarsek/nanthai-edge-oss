import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Globe2, LoaderCircle, LockKeyhole, Sparkles, Square } from "lucide-react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { AdvisorBatchView, AdvisorRunView } from "@/advisors/types";
import { captureAnalytics } from "@/lib/analytics";
import { structuredErrorMessage } from "@/lib/persistedGenerationError";
import { formatCost } from "@/hooks/useChatCosts";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { convexErrorMessage } from "@/lib/convexErrors";

type LegacyBatchView = {
  batch: Omit<AdvisorBatchView, "runs">;
  runs: AdvisorRunView[];
};

function normalizeBatchView(value: AdvisorBatchView | LegacyBatchView | null | undefined): AdvisorBatchView | null {
  if (!value) return null;
  if ("batch" in value) return { ...value.batch, runs: value.runs };
  return value;
}

function isActive(status: AdvisorBatchView["status"]): boolean {
  return status === "queued" || status === "running" || status === "synthesizing";
}

function canCancel(status: AdvisorBatchView["status"]): boolean {
  return status === "queued" || status === "running";
}

function displayAdvice(run: AdvisorRunView): string {
  return run.advice?.trim() || run.partialAdvice?.trim() || "";
}

interface AdvisorBatchPanelProps {
  batchId: Id<"advisorBatches">;
  compact?: boolean;
  showAdvancedStats?: boolean;
}

export function AdvisorBatchPanel({ batchId, compact = false, showAdvancedStats = false }: AdvisorBatchPanelProps) {
  const { t } = useTranslation();
  const rawBatchView = useQuery(api.advisors.queries.getBatchView, { batchId }) as
    | AdvisorBatchView
    | LegacyBatchView
    | null
    | undefined;
  const cancelBatch = useMutation(api.advisors.mutations.cancelBatch);
  const normalizedBatch = normalizeBatchView(rawBatchView);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const runs = useMemo(
    () => [...(normalizedBatch?.runs ?? [])].sort((left, right) => left.sortOrder - right.sortOrder),
    [normalizedBatch?.runs],
  );
  const selectedRun = runs.find((run) => String(run._id) === selectedRunId) ?? runs[0] ?? null;
  const selectedAdvice = selectedRun ? displayAdvice(selectedRun) : "";

  if (!normalizedBatch) return null;
  const batch = normalizedBatch;

  const active = isActive(batch.status);
  const cancellationAvailable = canCancel(batch.status);
  const respondedCount = batch.completedRunCount;
  let title = t("advisor_preparing");
  if (batch.status === "synthesizing") title = t("advisor_synthesizing");
  else if (batch.status === "completed") title = t("advisor_completed");
  else if (batch.status === "failed") title = t("advisor_failed");
  else if (batch.status === "cancelled") title = t("advisor_cancelled");
  else if (runs.length === 1 && (selectedRun?.status === "consulting" || selectedRun?.status === "streaming")) {
    title = t("advisor_reviewing", { name: selectedRun?.personaSnapshot.displayName ?? t("advisor") });
  } else if (respondedCount > 0) {
    title = t("advisor_responded_count", { completed: respondedCount, total: batch.expectedRunCount });
  }

  function toggleExpanded() {
    const next = !isExpanded;
    setIsExpanded(next);
    if (next) {
      captureAnalytics("advisor_advice_expanded", {
        feature_area: "advisors",
        chat_id: String(batch.chatId),
        batch_id: String(batch._id),
        advisor_count: batch.expectedRunCount,
        status: batch.status,
      });
    }
  }

  async function handleCancel() {
    if (isCancelling) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      await cancelBatch({ batchId });
    } catch (error) {
      setCancelError(convexErrorMessage(error, t("advisor_cancel_failed")));
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <section className={`${compact ? "mt-1.5 p-2" : "mt-2 p-3"} rounded-xl border border-primary/20 bg-primary/5`}>
      <div className="flex items-center gap-2">
        <Sparkles size={compact ? 12 : 14} className={`shrink-0 text-primary ${active ? "animate-pulse" : ""}`} />
        <button type="button" onClick={toggleExpanded} className="min-w-0 flex-1 text-left">
          <span className={`${compact ? "text-[10px]" : "text-xs"} block truncate font-semibold text-foreground`}>{title}</span>
          {!compact && <span className="flex items-center gap-1 text-[10px] text-muted"><LockKeyhole size={9} /> {t("private_advice")}</span>}
        </button>
        {cancellationAvailable && !compact && (
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={isCancelling}
            aria-label={cancelError ? t("retry_stop_advisors") : t("stop_advisors")}
            className="rounded p-1 text-muted hover:bg-surface-3 hover:text-foreground disabled:opacity-50"
          >
            {isCancelling ? <LoaderCircle size={12} className="animate-spin" /> : <Square size={11} fill="currentColor" />}
          </button>
        )}
        <button type="button" onClick={toggleExpanded} aria-expanded={isExpanded} aria-label={isExpanded ? t("collapse_advisor_advice") : t("expand_advisor_advice")} className="rounded p-1 text-muted hover:bg-surface-3 hover:text-foreground">
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
      {cancelError && (
        <p role="alert" className="mt-2 text-[10px] text-destructive">{cancelError}</p>
      )}

      {isExpanded && (
        <div className="mt-2 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            {runs.map((run) => {
              const selected = run._id === selectedRun?._id;
              return (
                <button
                  key={run._id}
                  type="button"
                  onClick={() => setSelectedRunId(String(run._id))}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${selected ? "border-primary/35 bg-primary/15 text-primary" : "border-border/30 bg-surface-2 text-muted"}`}
                >
                  <PersonaAvatar
                    personaId={run.personaId}
                    personaName={run.personaSnapshot.displayName}
                    personaEmoji={run.personaSnapshot.avatarEmoji}
                    personaAvatarImageUrl={run.personaSnapshot.avatarImageUrl}
                    className="h-4 w-4"
                    emojiClass="text-[9px]"
                    initialClass="text-[8px]"
                    iconSize={8}
                  />
                  <span>{run.personaSnapshot.displayName}</span>
                  {run.allowWebSearch && <Globe2 size={9} className="text-blue-400" />}
                  {(run.status === "preparing_context" || run.status === "streaming" || run.status === "consulting") && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
                </button>
              );
            })}
          </div>

          {selectedRun && (
            <div className={`${compact ? "text-[10px]" : "text-xs"} rounded-xl border border-border/25 bg-surface-1/80 p-2.5`}>
              {selectedAdvice ? (
                <MarkdownRenderer content={selectedAdvice} compact={compact} streaming={selectedRun.status === "streaming"} />
              ) : !selectedRun.errorMessage
                && selectedRun.status !== "cancelled"
                && selectedRun.status !== "timedOut"
                && selectedRun.status !== "failed" ? (
                  <p className="animate-pulse text-muted">{t("advisor_waiting_for_advice")}</p>
                ) : null}
              {!selectedRun.errorMessage && selectedRun.status === "cancelled" && (
                <p className="text-muted">{t("advisor_run_cancelled")}</p>
              )}
              {!selectedRun.errorMessage && selectedRun.status === "timedOut" && (
                <p className="text-destructive">{t("advisor_run_timed_out")}</p>
              )}
              {!selectedRun.errorMessage && selectedRun.status === "failed" && (
                <p className="text-destructive">{t("advisor_run_failed")}</p>
              )}
              {selectedRun.errorMessage && (
                <p className="mt-2 text-destructive">{structuredErrorMessage(selectedRun.errorMessage) ?? selectedRun.errorMessage}</p>
              )}
              {showAdvancedStats && (
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border/20 pt-2 font-mono text-[9px] text-muted">
                  <span>{selectedRun.actualModelId ?? selectedRun.requestedModelId}</span>
                  {selectedRun.durationMs != null && <span>{(selectedRun.durationMs / 1000).toFixed(1)}s</span>}
                  {selectedRun.cost != null
                    ? <span>{formatCost(selectedRun.cost)}</span>
                    : selectedRun.usage?.cost != null
                      ? <span>{formatCost(selectedRun.usage.cost)}</span>
                      : null}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
