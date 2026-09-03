import type { Id } from "../_generated/dataModel";
import type { ToolExecutionContext, ToolResult } from "./registry";

export interface RequiredMediaToolContext {
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  executionAttemptId: Id<"executionAttempts">;
  executionFence: number;
  toolCallId: string;
}

export function requireMediaToolContext(
  toolCtx: ToolExecutionContext,
): RequiredMediaToolContext | ToolResult {
  if (
    !toolCtx.chatId || !toolCtx.messageId || !toolCtx.jobId ||
    !toolCtx.executionAttemptId || toolCtx.executionFence === undefined ||
    !toolCtx.toolCallId
  ) {
    return {
      success: false,
      data: null,
      error: "Media generation requires an active, fenced chat generation.",
    };
  }
  return {
    chatId: toolCtx.chatId as Id<"chats">,
    messageId: toolCtx.messageId as Id<"messages">,
    jobId: toolCtx.jobId as Id<"generationJobs">,
    executionAttemptId: toolCtx.executionAttemptId,
    executionFence: toolCtx.executionFence,
    toolCallId: toolCtx.toolCallId,
  };
}

export function isMediaToolError(
  value: RequiredMediaToolContext | ToolResult,
): value is ToolResult {
  return "success" in value;
}

export function requiredPrompt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const prompt = value.trim();
  return prompt.length > 0 && prompt.length <= 50_000 ? prompt : null;
}

export function optionalModelId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const modelId = value.trim();
  return modelId || undefined;
}
