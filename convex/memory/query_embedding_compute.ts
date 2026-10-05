import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { computeUserEmbedding } from "./embedding_helpers";
import { hashMemoryCacheTextForPrivacyMode } from "./cache_helpers";

function getStableEmbeddingErrorCode(error: unknown): string {
  if (
    error instanceof ConvexError
    && typeof error.data?.code === "string"
    && error.data.code.trim().length > 0
  ) {
    return error.data.code.trim().toLowerCase();
  }
  return "primary_embedding_exception";
}

export async function computePrimaryEmbeddingForMessage(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "scheduler">,
  args: {
    messageId: Id<"messages">;
    userId: string;
    chatId?: Id<"chats">;
    queryText: string;
    requireZdr: boolean;
  },
): Promise<void> {
  const now = Date.now();
  const textHash = hashMemoryCacheTextForPrivacyMode(args.queryText, args.requireZdr);
  if (args.queryText.length === 0) {
    await ctx.runMutation(internal.memory.operations.completeMessageQueryEmbedding, {
      messageId: args.messageId,
      textHash,
      status: "failed",
      errorCode: "empty_query",
      now,
    });
    return;
  }

  try {
    const embeddingResult = await computeUserEmbedding(ctx, args.userId, args.queryText, {
      requireZdr: args.requireZdr,
    });
    await ctx.runMutation(internal.memory.operations.completeMessageQueryEmbedding, {
      messageId: args.messageId,
      textHash,
      status: embeddingResult ? "ready" : "failed",
      embedding: embeddingResult?.embedding,
      provider: embeddingResult?.provider,
      usage: embeddingResult?.usage,
      generationId: embeddingResult?.generationId,
      errorCode: embeddingResult ? undefined : "primary_embedding_failed",
      now: Date.now(),
    });
  } catch (error) {
    await ctx.runMutation(internal.memory.operations.completeMessageQueryEmbedding, {
      messageId: args.messageId,
      textHash,
      status: "failed",
      errorCode: getStableEmbeddingErrorCode(error),
      now: Date.now(),
    });
  }
}

