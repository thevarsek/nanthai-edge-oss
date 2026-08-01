import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ToolCall } from "../lib/openrouter";
import type { ToolResult } from "./registry";

type LinkInput = {
  ctx: ActionCtx;
  metadata: {
    userId: string;
    chatId: Id<"chats">;
    jobId: Id<"generationJobs">;
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
  };
  toolCalls: ToolCall[];
  results: Array<{ toolCallId: string; result: ToolResult }>;
};

function invocationId(result: ToolResult): string | undefined {
  for (const candidate of [result.artifactData, result.data]) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const value = (candidate as Record<string, unknown>).invocationId;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export async function attachRemoteMcpArtifacts(
  input: LinkInput,
  artifactIds: Array<Id<"toolExecutionArtifacts">>,
): Promise<void> {
  const capturedCalls = input.toolCalls.filter((call) =>
    input.results.some((entry) => entry.toolCallId === call.id));
  for (let index = 0; index < capturedCalls.length; index += 1) {
    const call = capturedCalls[index];
    const artifactId = artifactIds[index];
    if (!call || !artifactId) continue;
    const matching = input.results.find((entry) => entry.toolCallId === call.id);
    const publicId = matching ? invocationId(matching.result) : undefined;
    if (!publicId) continue;
    await input.ctx.runMutation(internal.mcp.invocation_mutations.attachArtifacts, {
      publicId,
      userId: input.metadata.userId,
      chatId: input.metadata.chatId,
      jobId: input.metadata.jobId,
      artifactIds: [artifactId],
      executionAttemptId: input.metadata.executionAttemptId,
      executionFence: input.metadata.executionFence,
    });
  }
}
