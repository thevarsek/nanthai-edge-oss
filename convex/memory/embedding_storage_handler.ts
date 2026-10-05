import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { computeUserEmbedding } from "./embedding_helpers";
import { MODEL_IDS } from "../lib/model_constants";
import { isZdrEnabled } from "../lib/openrouter_zdr";

export interface ComputeAndStoreEmbeddingArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
  content: string;
}

export async function computeAndStoreEmbeddingHandler(
  ctx: ActionCtx,
  args: ComputeAndStoreEmbeddingArgs,
): Promise<void> {
  const memory = await ctx.runQuery(internal.memory.operations.getMemoryDoc, {
    memoryId: args.memoryId,
  });
  if (!memory?.userId) return;
  const writable = await ctx.runQuery(internal.lib.write_fence.isWritable, {
    userId: memory.userId,
    chatId: memory.sourceChatId,
  });
  if (!writable) return;

  const preferences = await ctx.runQuery(internal.chat.queries.getUserPreferences, {
    userId: memory.userId,
  });
  let embeddingResult: Awaited<ReturnType<typeof computeUserEmbedding>>;
  try {
    embeddingResult = await computeUserEmbedding(ctx, memory.userId, args.content, {
      requireZdr: isZdrEnabled(preferences),
    });
  } catch (error) {
    if (
      error instanceof ConvexError &&
      error.data?.code === "ZDR_EMBEDDING_UNAVAILABLE"
    ) {
      console.warn("[memory] skipped embedding storage under ZDR", {
        memoryId: args.memoryId,
        userId: memory.userId,
      });
      return;
    }
    throw error;
  }
  if (!embeddingResult) return;

  await ctx.runMutation(internal.memory.operations.storeEmbedding, {
    memoryId: args.memoryId,
    userId: memory.userId,
    embedding: embeddingResult.embedding,
  });
  await ctx.scheduler.runAfter(0, internal.execution.workload_queues.enqueueMemoryRelationship, {
    memoryId: args.memoryId,
  });

  // M23: Track embedding cost if the memory has chat attribution.
  if (embeddingResult.usage && embeddingResult.usage.billingOwner !== "platform" && memory.sourceChatId && memory.sourceMessageId) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: memory.sourceMessageId,
      chatId: memory.sourceChatId,
      userId: memory.userId,
      modelId: MODEL_IDS.embedding,
      promptTokens: embeddingResult.usage.promptTokens,
      completionTokens: 0,
      totalTokens: embeddingResult.usage.totalTokens,
      source: "memory_embedding_store",
      generationId: embeddingResult.generationId ?? undefined,
    });
  }
}

