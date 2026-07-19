import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

async function deleteStorageIds(
  ctx: MutationCtx,
  ids: Array<Id<"_storage"> | undefined>,
): Promise<void> {
  const unique = new Set(ids.filter((id): id is Id<"_storage"> => id !== undefined));
  for (const storageId of unique) {
    await ctx.storage.delete(storageId).catch(() => undefined);
  }
}

export async function cancelAndCleanupForExecutionRun(
  ctx: MutationCtx,
  executionRunId: Id<"executionRuns">,
): Promise<boolean> {
  const analyticsRun = await ctx.db
    .query("analyticsWorkflowRuns")
    .withIndex("by_execution_run", (q) => q.eq("executionRunId", executionRunId))
    .unique();
  if (!analyticsRun || ["completed", "failed", "cancelled"].includes(analyticsRun.status)) return true;
  const intents = await ctx.db
    .query("analyticsArtifactIntents")
    .withIndex("by_run", (q) => q.eq("analyticsRunId", analyticsRun._id))
    .take(40);
  await deleteStorageIds(ctx, [
    analyticsRun.executionEnvelopeStorageId,
    analyticsRun.normalizedResultStorageId,
    analyticsRun.resultStorageId,
    ...intents.map((intent) => intent.storageId),
  ]);
  for (const intent of intents) await ctx.db.delete(intent._id);
  if (intents.length === 40) return false;
  const toolArtifacts = await ctx.db
    .query("toolExecutionArtifacts")
    .withIndex("by_tool_call", (q) => q.eq("toolCallId", analyticsRun.toolCallId))
    .collect();
  for (const artifact of toolArtifacts) {
    if (artifact.jobId !== analyticsRun.jobId || artifact.userId !== analyticsRun.userId) continue;
    await ctx.db.patch(artifact._id, {
      status: "cancelled",
      errorMessage: "Analytics execution cancelled",
      updatedAt: Date.now(),
    });
  }
  await ctx.db.patch(analyticsRun._id, {
    status: "cancelled",
    phase: "cancelled",
    executionEnvelopeStorageId: undefined,
    normalizedResultStorageId: undefined,
    resultStorageId: undefined,
    completedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return true;
}

export async function deleteForMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
): Promise<void> {
  const runs = await ctx.db
    .query("analyticsWorkflowRuns")
    .withIndex("by_message", (q) => q.eq("messageId", messageId))
    .collect();
  for (const run of runs) {
    const intents = await ctx.db
      .query("analyticsArtifactIntents")
      .withIndex("by_run", (q) => q.eq("analyticsRunId", run._id))
      .collect();
    await deleteStorageIds(ctx, [
      run.executionEnvelopeStorageId,
      run.normalizedResultStorageId,
      run.resultStorageId,
      ...intents.map((intent) => intent.storageId),
    ]);
    for (const intent of intents) await ctx.db.delete(intent._id);
    await ctx.db.delete(run._id);
  }
}

export async function deleteForChatBatch(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  limit: number,
): Promise<boolean> {
  const runs = await ctx.db
    .query("analyticsWorkflowRuns")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(limit);
  for (const run of runs) {
    const intents = await ctx.db
      .query("analyticsArtifactIntents")
      .withIndex("by_run", (q) => q.eq("analyticsRunId", run._id))
      .collect();
    await deleteStorageIds(ctx, [
      run.executionEnvelopeStorageId,
      run.normalizedResultStorageId,
      run.resultStorageId,
      ...intents.map((intent) => intent.storageId),
    ]);
    for (const intent of intents) await ctx.db.delete(intent._id);
    await ctx.db.delete(run._id);
  }
  return runs.length === limit;
}
