import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Layers } from "lucide-react";

import { statusBadgeClass, statusTextClass } from "@/lib/uiTokens";
import { MarkdownRenderer } from "./MarkdownRenderer";

export interface AgentActivityItem {
  id: string;
  title: string;
  subtitle?: string | null;
  status: string;
  statusLabel: string;
  statusSummary?: string | null;
  prompt?: string | null;
  activity?: string | null;
  output?: string | null;
  error?: string | null;
  isStreaming?: boolean;
}

interface AgentActivityPanelLabels {
  collapse: string;
  expand: string;
  prompt: string;
  activity: string;
  output: string;
}

interface AgentActivityPanelProps {
  title: string;
  status: string;
  summary?: string | null;
  isActive: boolean;
  items: AgentActivityItem[];
  labels: AgentActivityPanelLabels;
  emptyLabel?: string;
  footerLabel?: string;
  testId?: string;
  activityCollapsible?: boolean;
  boundedContent?: boolean;
  showOutputLabel?: boolean;
  showSingleItemTitle?: boolean;
}

function ActivitySection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      {children}
    </section>
  );
}

export function AgentActivityPanel({
  title,
  status,
  summary,
  isActive,
  items,
  labels,
  emptyLabel,
  footerLabel,
  testId,
  activityCollapsible = false,
  boundedContent = false,
  showOutputLabel = true,
  showSingleItemTitle = true,
}: AgentActivityPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItem = useMemo(() => {
    if (!items.length) return null;
    return items.find((item) => item.id === selectedItemId) ?? items[0];
  }, [items, selectedItemId]);

  return (
    <div
      className="mt-2 rounded-xl border border-border/20 bg-surface-2/50 p-3"
      data-testid={testId}
    >
      <div className="flex items-center justify-between gap-2">
        <div className={`flex min-w-0 items-center gap-2 text-xs font-semibold ${statusTextClass(status)}`}>
          <Layers size={14} className={isActive ? "shrink-0 animate-pulse" : "shrink-0"} />
          <span className="truncate">{title}</span>
          {summary && <span className="shrink-0 text-[10px] font-normal text-muted">{summary}</span>}
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-label={isExpanded ? labels.collapse : labels.expand}
          aria-expanded={isExpanded}
          className="rounded p-1 text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
        >
          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {items.length > 1 && (
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {items.map((item) => {
                const active = item.id === selectedItem?.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedItemId(item.id)}
                    className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary/30 bg-primary/15 text-primary"
                        : "border-border/20 bg-surface-2/50 text-muted hover:bg-surface-3/50"
                    }`}
                  >
                    {item.title}
                  </button>
                );
              })}
            </div>
          )}

          {selectedItem ? (
            <div className={boundedContent ? "max-h-64 space-y-2 overflow-y-auto pr-1" : "space-y-2"}>
              <div className="flex flex-wrap items-center gap-2">
                {items.length === 1 && showSingleItemTitle && (
                  <p className="text-xs font-semibold text-foreground">{selectedItem.title}</p>
                )}
                {selectedItem.subtitle && <p className="text-[10px] text-muted">{selectedItem.subtitle}</p>}
                <p className={statusBadgeClass(selectedItem.status, "w-fit border-0")}>
                  {selectedItem.statusLabel}
                </p>
              </div>
              {selectedItem.statusSummary && (
                <p className="whitespace-pre-wrap text-xs text-muted">{selectedItem.statusSummary}</p>
              )}
              {selectedItem.prompt && (
                <ActivitySection label={labels.prompt}>
                  <p className="whitespace-pre-wrap text-xs text-muted">{selectedItem.prompt}</p>
                </ActivitySection>
              )}
              {selectedItem.activity && (
                activityCollapsible ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted transition-colors hover:text-foreground">
                      {labels.activity}
                    </summary>
                    <div className="mt-1 whitespace-pre-wrap border-l-2 border-primary/20 pl-2 text-muted">
                      {selectedItem.activity}
                    </div>
                  </details>
                ) : (
                  <ActivitySection label={labels.activity}>
                    <p className="whitespace-pre-wrap text-xs text-muted">{selectedItem.activity}</p>
                  </ActivitySection>
                )
              )}
              {selectedItem.output && (
                showOutputLabel ? (
                  <ActivitySection label={labels.output}>
                    <div className="text-xs">
                      <MarkdownRenderer content={selectedItem.output} streaming={selectedItem.isStreaming === true} />
                    </div>
                  </ActivitySection>
                ) : (
                  <div className="text-xs">
                    <MarkdownRenderer content={selectedItem.output} streaming={selectedItem.isStreaming === true} />
                  </div>
                )
              )}
              {selectedItem.error && (
                <p role="alert" className="text-xs text-destructive">{selectedItem.error}</p>
              )}
            </div>
          ) : (
            emptyLabel && <p className="text-xs text-muted">{emptyLabel}</p>
          )}
          {footerLabel && <p className="text-[10px] text-muted">{footerLabel}</p>}
        </div>
      )}
    </div>
  );
}
