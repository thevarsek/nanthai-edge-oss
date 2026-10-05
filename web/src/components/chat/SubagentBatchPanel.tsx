// components/chat/SubagentBatchPanel.tsx
// In-message panel showing delegated subagent work for a message.
// Mirrors iOS SubagentBatchPanel: status header, horizontal run tabs, content display.

import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { AgentActivityPanel } from "./AgentActivityPanel";

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
  batchId: Id<"subagentBatches">;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// ─── Component ──────────────────────────────────────────────────────────────

export function SubagentBatchPanel({ messageId, batchId }: Props) {
  const { t } = useTranslation();
  const batchView = useQuery(api.subagents.queries.getBatchView, { messageId, batchId }) as BatchView | null | undefined;

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
      case "waiting_continuation": return t("waiting_to_resume");
      case "completed": return t("completed");
      case "failed": return t("failed");
      case "cancelled": return t("cancelled");
      case "timedOut": return t("timed_out");
      default: return status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  if (!batchView) return null;

  const { batch } = batchView;
  const title = headerTitle(batch.status);
  const isActive = batch.status === "running_children" || batch.status === "resuming";
  const items = [...batchView.runs]
    .sort((a, b) => a.childIndex - b.childIndex)
    .map((run) => ({
      id: run._id,
      title: run.title,
      status: run.status,
      statusLabel: runStatusLabel(run.status),
      activity: run.reasoning,
      output: run.content,
      error: run.error,
      isStreaming: run.status === "streaming",
    }));

  return (
    <AgentActivityPanel
      title={title}
      status={batch.status}
      summary={isActive ? `(${batch.completedChildCount}/${batch.childCount})` : undefined}
      isActive={isActive}
      items={items}
      labels={{
        collapse: t("collapse_subagent_details"),
        expand: t("expand_subagent_details"),
        prompt: t("prompt"),
        activity: t("reasoning"),
        output: t("response"),
      }}
      activityCollapsible
      showOutputLabel={false}
      showSingleItemTitle={false}
    />
  );
}
