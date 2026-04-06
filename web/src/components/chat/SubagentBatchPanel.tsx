// components/chat/SubagentBatchPanel.tsx
// In-message panel showing delegated subagent work for a message.
// Mirrors iOS SubagentBatchPanel: status header, horizontal run tabs, content display.

import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { Layers, ChevronDown, ChevronUp } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

// ─── Types ──────────────────────────────────────────────────────────────────

interface SubagentRun {
  _id: string;
  childIndex: number;
  title: string;
  taskPrompt: string;
  status: string;
  content?: string | null;
  reasoning?: string | null;
  error?: string | null;
}

interface SubagentBatch {
  status: string;
  childCount: number;
  completedChildCount: number;
  failedChildCount: number;
}

interface BatchView {
  batch: SubagentBatch;
  runs: SubagentRun[];
}

interface Props {
  messageId: Id<"messages">;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// ─── Component ──────────────────────────────────────────────────────────────

export function SubagentBatchPanel({ messageId }: Props) {
  const { t } = useTranslation();
  const batchView = useQuery(api.subagents.queries.getBatchView, { messageId }) as BatchView | null | undefined;
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  function headerTitle(status: string): string {
    switch (status) {
      case "running_children": return t("running_subagents");
      case "waiting_to_resume": return t("waiting_to_resume");
      case "resuming": return t("synthesizing");
      case "completed": return t("subagents_completed");
      case "failed": return t("subagents_failed");
      case "cancelled": return t("subagents_cancelled");
      default: return t("subagents");
    }
  }

  function runStatusLabel(status: string): string {
    switch (status) {
      case "queued": return t("queued");
      case "streaming": return t("running");
      case "completed": return t("completed");
      case "failed": return t("failed");
      case "cancelled": return t("cancelled");
      case "timedOut": return t("timed_out");
      default: return status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  const sortedRuns = useMemo(
    () => [...(batchView?.runs ?? [])].sort((a, b) => a.childIndex - b.childIndex),
    [batchView?.runs],
  );

  const selectedRun = useMemo(() => {
    if (!sortedRuns.length) return null;
    if (selectedRunId) return sortedRuns.find((r) => r._id === selectedRunId) ?? sortedRuns[0];
    return sortedRuns[0];
  }, [sortedRuns, selectedRunId]);

  if (!batchView) return null;

  const { batch } = batchView;
  const title = headerTitle(batch.status);
  const isActive = batch.status === "running_children" || batch.status === "resuming";

  return (
    <div className="mt-2 rounded-xl bg-surface-2/50 border border-border/20 p-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Layers size={14} className={isActive ? "animate-pulse" : ""} />
          <span>{title}</span>
          {isActive && (
            <span className="text-[10px] text-muted font-normal">
              ({batch.completedChildCount}/{batch.childCount})
            </span>
          )}
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="p-1 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {/* Run tabs (only if multiple) */}
          {sortedRuns.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {sortedRuns.map((run) => {
                const active = run._id === (selectedRun?._id ?? sortedRuns[0]?._id);
                return (
                  <button
                    key={run._id}
                    onClick={() => setSelectedRunId(run._id)}
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                      active
                        ? "bg-primary/15 text-primary border border-primary/30"
                        : "bg-surface-2/50 text-muted border border-border/20 hover:bg-surface-3/50"
                    }`}
                  >
                    {run.title}
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected run content */}
          {selectedRun && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-medium text-muted">
                {runStatusLabel(selectedRun.status)}
              </p>
              {selectedRun.reasoning && (
                <details className="text-xs">
                  <summary className="text-muted cursor-pointer hover:text-foreground transition-colors">
                    {t("reasoning")}
                  </summary>
                  <div className="mt-1 pl-2 border-l-2 border-primary/20 text-muted">
                    {selectedRun.reasoning}
                  </div>
                </details>
              )}
              {selectedRun.content && (
                <div className="text-xs">
                  <MarkdownRenderer content={selectedRun.content} streaming={false} />
                </div>
              )}
              {selectedRun.error && (
                <p className="text-xs text-red-400">{selectedRun.error}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
