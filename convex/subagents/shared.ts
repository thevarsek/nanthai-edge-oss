import { ChatRequestParameters, OpenRouterMessage } from "../lib/openrouter";
import { ParticipantConfig } from "../chat/actions_run_generation_types";
import { Id } from "../_generated/dataModel";

export interface SubagentTask {
  title: string;
  prompt: string;
}

export interface ParentBatchParamsSnapshot {
  enabledIntegrations?: string[];
  requestParams: ChatRequestParameters;
}

export interface ParentBatchParticipantSnapshot {
  chatId: Id<"chats">;
  userId: string;
  participant: ParticipantConfig;
}

// Allow one Convex action budget plus a small buffer before reclaiming a stale
// subagent lease after a worker crash.
export const SUBAGENT_RECOVERY_LEASE_MS = 11 * 60 * 1000;

export function buildSubagentTaskPrompt(task: SubagentTask): string {
  return [
    "You are a delegated helper working for the parent assistant.",
    "Stay tightly focused on the task below. Use tools when helpful.",
    "Return a concise final report the parent assistant can synthesize directly.",
    "",
    `Task title: ${task.title}`,
    "Task:",
    task.prompt,
  ].join("\n");
}

export function isTerminalSubagentStatus(status: string): boolean {
  return status === "completed"
    || status === "failed"
    || status === "cancelled"
    || status === "timedOut";
}

export function isSubagentLeaseStale(
  updatedAt: number | undefined,
  now: number,
): boolean {
  if (updatedAt === undefined) {
    return false;
  }
  return now - updatedAt >= SUBAGENT_RECOVERY_LEASE_MS;
}

export function buildParentContinuationPayload(
  runs: Array<{
    childIndex: number;
    title: string;
    status: string;
    content?: string;
    error?: string;
    generatedFiles?: Array<{
      storageId: Id<"_storage">;
      filename: string;
      mimeType: string;
      sizeBytes?: number;
      toolName: string;
    }>;
    generatedCharts?: Array<{
      toolName: string;
      chartType: "line" | "bar" | "scatter" | "pie" | "box";
      title?: string;
      xLabel?: string;
      yLabel?: string;
      xUnit?: string;
      yUnit?: string;
      elements: unknown;
    }>;
  }>,
) {
  return {
    subagents: runs.map((run) => ({
      childIndex: run.childIndex,
      title: run.title,
      status: run.status,
      summary: run.content ?? "",
      error: run.error,
      generatedFiles: run.generatedFiles ?? [],
      generatedCharts: run.generatedCharts ?? [],
    })),
  };
}

export function normalizeOpenRouterMessages(
  messages: OpenRouterMessage[],
): OpenRouterMessage[] {
  return messages.map((message) => ({ ...message }));
}
