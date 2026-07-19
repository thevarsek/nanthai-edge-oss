import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type { ToolRoundArtifactInput } from "./artifact_writer";

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function toolRoundCaptureKey(input: ToolRoundArtifactInput): Promise<string> {
  const semanticCalls = await Promise.all(input.toolCalls.map(async (call, index) => ({
    index,
    toolName: call.function.name,
    argumentsHash: await sha256Hex(call.function.arguments || "{}"),
  })));
  return await sha256Hex(JSON.stringify({
    jobId: input.metadata.jobId,
    runtimeKind: input.metadata.runtimeKind ?? "chat_generation",
    ownerModelRunId: input.metadata.ownerModelRunId,
    subagentRunId: input.metadata.subagentRunId,
    round: input.round,
    calls: semanticCalls,
  }));
}

export async function deleteStoredPayloads(
  ctx: ActionCtx,
  storageIds: Id<"_storage">[],
): Promise<void> {
  await Promise.all(storageIds.map(async (storageId) => {
    await ctx.storage.delete(storageId).catch(() => undefined);
  }));
}
