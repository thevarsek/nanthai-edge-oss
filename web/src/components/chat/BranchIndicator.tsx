// components/chat/BranchIndicator.tsx
// Compact pill between messages at fork points.
// Two variants:
//   1. Switchable branches (not all on path): "Branch X of Y" with < > chevron nav.
//   2. Merged-back branches (all on path): dimmer pill with "Jump ↓" to scroll to
//      the next sibling. Explanatory helper text appears under both variants.

import { ChevronLeft, ChevronRight, GitBranch, ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import type { BranchNode } from "@/hooks/useBranching";

interface BranchIndicatorProps {
  node: BranchNode;
  onNavigate: (messageId: Id<"messages">, direction: "prev" | "next") => void;
  /** Scroll to the next sibling on the active path (merged-back branches). */
  onJumpToNext?: (messageId: Id<"messages">) => void;
}

export function BranchIndicator({ node, onNavigate, onJumpToNext }: BranchIndicatorProps) {
  const current = node.activeIndex + 1;
  const total = node.siblings.length;

  if (node.allOnPath) {
    return <MergedBranchPill node={node} current={current} total={total} onJumpToNext={onJumpToNext} />;
  }

  return <SwitchableBranchPill node={node} current={current} total={total} onNavigate={onNavigate} />;
}

// ─── Switchable variant ───────────────────────────────────────────────────────

function SwitchableBranchPill({
  node,
  current,
  total,
  onNavigate,
}: {
  node: BranchNode;
  current: number;
  total: number;
  onNavigate: (messageId: Id<"messages">, direction: "prev" | "next") => void;
}) {
  const { t } = useTranslation();
  const canGoPrev = node.activeIndex > 0;
  const canGoNext = node.activeIndex < node.siblings.length - 1;

  return (
    <div className="flex flex-col items-center py-1 gap-0.5">
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2/50 border border-border/20">
        <div className="flex items-center gap-1.5">
          <GitBranch size={11} className="text-muted" />
          <span className="text-[11px] font-medium font-mono text-muted">
            {t("branch_n_of_n", { var1: current, var2: total })}
          </span>
        </div>

        <div className="flex items-center">
          <button
            onClick={() => onNavigate(node.messageId, "prev")}
            disabled={!canGoPrev}
            className="p-0.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Previous branch"
          >
            <ChevronLeft size={13} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => onNavigate(node.messageId, "next")}
            disabled={!canGoNext}
            className="p-0.5 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label="Next branch"
          >
            <ChevronRight size={13} strokeWidth={2.5} />
          </button>
        </div>
      </div>
      <span className="text-[10px] text-muted/60 leading-tight">
        {t("different_versions_switch")}
      </span>
    </div>
  );
}

// ─── Merged-back variant ──────────────────────────────────────────────────────

function MergedBranchPill({
  node,
  current,
  total,
  onJumpToNext,
}: {
  node: BranchNode;
  current: number;
  total: number;
  onJumpToNext?: (messageId: Id<"messages">) => void;
}) {
  const { t } = useTranslation();
  const hasNext = node.activeIndex < node.siblings.length - 1;
  const nextSiblingId = hasNext ? node.siblings[node.activeIndex + 1] : undefined;

  return (
    <div className="flex flex-col items-center py-1 gap-0.5">
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-3/80 border border-border/40">
        <div className="flex items-center gap-1.5">
          <GitBranch size={11} className="text-secondary" />
          <span className="text-[11px] font-medium font-mono text-secondary">
            {t("branch_n_of_n", { var1: current, var2: total })}
          </span>
        </div>

        {nextSiblingId && onJumpToNext && (
          <button
            onClick={() => onJumpToNext(nextSiblingId)}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
            aria-label="Jump to next branch"
          >
            <span className="text-[10px] font-medium">{t("jump")}</span>
            <ArrowDown size={11} strokeWidth={2.5} />
          </button>
        )}
      </div>
      <span className="text-[10px] text-muted leading-tight">
        {t("all_branches_active_jump")}
      </span>
    </div>
  );
}
