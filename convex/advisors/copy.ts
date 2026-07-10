import type { Doc, Id } from "../_generated/dataModel";
import { conciseAdvisorFailure } from "../lib/openrouter_responses_error";
import type { MutationCtx } from "../_generated/server";

const COPYABLE_BATCH_STATUSES = new Set<Doc<"advisorBatches">["status"]>([
  "completed",
  "failed",
  "cancelled",
]);

export async function copyAdvisorData(
  ctx: MutationCtx,
  args: {
    sourceChatId: Id<"chats">;
    targetChatId: Id<"chats">;
    userId: string;
    messageIdMap: Map<string, string>;
  },
): Promise<void> {
  await copyAssignments(ctx, args);
  const sourceMessages = await ctx.db
    .query("messages")
    .withIndex("by_chat", (query) => query.eq("chatId", args.sourceChatId))
    .collect();
  const batches = await ctx.db
    .query("advisorBatches")
    .withIndex("by_chat", (query) => query.eq("chatId", args.sourceChatId))
    .collect();
  for (const batch of batches) {
    if (!COPYABLE_BATCH_STATUSES.has(batch.status)) continue;
    const userMessageId = mappedMessage(args.messageIdMap, batch.userMessageId);
    const mappedOriginalAssistantIds = batch.assistantMessageIds
      .map((messageId) => mappedMessage(args.messageIdMap, messageId))
      .filter((messageId): messageId is Id<"messages"> => messageId != null);
    const linkedCopiedMessageIds = new Set<Id<"messages">>(mappedOriginalAssistantIds);
    for (const sourceMessage of sourceMessages) {
      if (sourceMessage.advisorBatchId !== batch._id) continue;
      const copiedMessageId = mappedMessage(args.messageIdMap, sourceMessage._id);
      if (copiedMessageId) linkedCopiedMessageIds.add(copiedMessageId);
    }
    if (!userMessageId || linkedCopiedMessageIds.size === 0) continue;
    // A fork can include only a retry response while its original response is
    // outside the copied prefix. Keep the terminal consultation reachable by
    // using that retry node as the copied batch's assistant anchor.
    const assistantMessageIds = mappedOriginalAssistantIds.length > 0
      ? mappedOriginalAssistantIds
      : [...linkedCopiedMessageIds];
    const newBatchId = await ctx.db.insert("advisorBatches", {
      userId: args.userId,
      chatId: args.targetChatId,
      userMessageId,
      assistantMessageIds,
      status: batch.status,
      brief: batch.brief,
      expectedRunCount: batch.expectedRunCount,
      completedRunCount: batch.completedRunCount,
      failedRunCount: batch.failedRunCount,
      generationSnapshot: { kind: "copied_terminal", sourceBatchId: String(batch._id) },
      scheduledFinalGenerationAt: batch.scheduledFinalGenerationAt,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    });
    const runs = await ctx.db
      .query("advisorRuns")
      .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
      .collect();
    for (const run of runs) {
      await ctx.db.insert("advisorRuns", copiedRun(run, newBatchId, args.targetChatId, userMessageId));
    }
    for (const copiedMessageId of linkedCopiedMessageIds) {
      await ctx.db.patch(copiedMessageId, { advisorBatchId: newBatchId });
    }
  }
}

async function copyAssignments(
  ctx: MutationCtx,
  args: {
    sourceChatId: Id<"chats">;
    targetChatId: Id<"chats">;
    userId: string;
  },
): Promise<void> {
  const assignments = await ctx.db
    .query("chatAdvisors")
    .withIndex("by_chat", (query) => query.eq("chatId", args.sourceChatId))
    .collect();
  const now = Date.now();
  for (const assignment of assignments) {
    await ctx.db.insert("chatAdvisors", {
      userId: args.userId,
      chatId: args.targetChatId,
      personaId: assignment.personaId,
      instanceName: assignment.instanceName,
      sortOrder: assignment.sortOrder,
      allowWebSearch: assignment.allowWebSearch,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function copiedRun(
  run: Doc<"advisorRuns">,
  batchId: Id<"advisorBatches">,
  chatId: Id<"chats">,
  userMessageId: Id<"messages">,
): Omit<Doc<"advisorRuns">, "_id" | "_creationTime"> {
  return {
    batchId,
    userId: run.userId,
    chatId,
    userMessageId,
    personaId: run.personaId,
    personaAvatarStorageId: run.personaAvatarStorageId,
    personaSnapshot: run.personaSnapshot,
    instanceName: run.instanceName,
    sortOrder: run.sortOrder,
    status: run.status,
    stage: run.stage,
    brief: run.brief,
    allowWebSearch: run.allowWebSearch,
    resolvedInstructions: run.resolvedInstructions,
    requestedModelId: run.requestedModelId,
    actualModelId: run.actualModelId,
    partialAdvice: run.partialAdvice,
    advice: run.advice,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage === undefined
      ? undefined
      : conciseAdvisorFailure(run.errorMessage),
    responseId: run.responseId,
    outputItemId: run.outputItemId,
    replayItems: run.replayItems,
    usage: run.usage,
    cost: run.cost,
    startedAt: run.startedAt,
    lastActivityAt: run.lastActivityAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function mappedMessage(
  map: Map<string, string>,
  messageId: Id<"messages">,
): Id<"messages"> | undefined {
  return map.get(String(messageId)) as Id<"messages"> | undefined;
}
