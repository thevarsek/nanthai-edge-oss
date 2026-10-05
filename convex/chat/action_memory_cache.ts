import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MemoryRecordLike } from "../memory/shared";
import { MODEL_IDS } from "../lib/model_constants";
import { ttftLog } from "../lib/generation_log";
import { ensureMessageMemoryContextReady } from "../memory/memory_context_handlers";
import {
  captureBackendAIOperationCompleted,
  captureBackendAIOperationFailed,
  captureBackendAIOperationStarted,
} from "../analytics/backend_events";

export type ActionContextLike = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "scheduler" | "vectorSearch"
>;

const GENERATION_MEMORY_CONTEXT_WAIT_MS = 250;

interface HydratedHitsArgs {
  userId: string;
  chatId?: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageId?: Id<"messages">;
  memoryQueryText: string;
  requireZdr: boolean;
}

export async function resolveHydratedHits(
  ctx: ActionContextLike,
  args: HydratedHitsArgs,
): Promise<MemoryRecordLike[]> {
  const cacheStartedAt = Date.now();
  try {
    const contextRow = await ensureMessageMemoryContextReady(ctx, {
      messageId: args.userMessageId,
      userId: args.userId,
      chatId: args.chatId,
      queryText: args.memoryQueryText,
      leaseOwner: `generation:${args.assistantMessageId ?? args.userMessageId}`,
      requireZdr: args.requireZdr,
    }, {
      maxWaitMs: GENERATION_MEMORY_CONTEXT_WAIT_MS,
      claimAndCompute: false,
    });

    if (contextRow?.status === "ready" && Array.isArray(contextRow.hydratedHits)) {
      ttftLog("[generation] memory-context cache hit", {
        userId: args.userId,
        chatId: args.chatId ?? null,
        messageId: args.assistantMessageId ?? null,
        durationMs: Date.now() - cacheStartedAt,
        hitCount: contextRow.hydratedHits.length,
        hadUsage: contextRow.usage != null,
      });

      // Attribute embedding cost to the assistant message exactly once.
      if (contextRow.usage && contextRow.usage.billingOwner !== "platform" && args.chatId && args.assistantMessageId) {
        const marked = await ctx.runMutation(
          internal.memory.operations.markMessageMemoryContextUsageRecorded,
          {
            messageId: args.userMessageId,
            usageRecordedAt: Date.now(),
            usageRecordedMessageId: args.assistantMessageId,
          },
        );
        if (marked) {
          await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
            messageId: args.assistantMessageId,
            chatId: args.chatId,
            userId: args.userId,
            modelId: MODEL_IDS.embedding,
            promptTokens: contextRow.usage.promptTokens,
            completionTokens: 0,
            totalTokens: contextRow.usage.totalTokens,
            source: "memory_embedding_retrieve",
            generationId: contextRow.generationId ?? undefined,
          });
        }
      }
      return contextRow.hydratedHits as MemoryRecordLike[];
    }

    // Cache returned `failed` (including timeout) — log and degrade to [].
    // Matches the prior graceful-degrade behavior on vector-search errors.
    if (contextRow?.status === "failed") {
      console.warn("[generation] memory-context cache failed, returning empty", {
        userId: args.userId,
        chatId: args.chatId ?? null,
        messageId: args.assistantMessageId ?? null,
        durationMs: Date.now() - cacheStartedAt,
        errorCode: contextRow.errorCode ?? null,
      });
      await captureMemoryContextFallback(ctx, args, cacheStartedAt, "failed", contextRow.errorCode);
      return [];
    }

    console.warn("[generation] memory-context cache indeterminate, returning empty", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      durationMs: Date.now() - cacheStartedAt,
    });
    await captureMemoryContextFallback(
      ctx,
      args,
      cacheStartedAt,
      contextRow?.status ?? "missing",
    );
  } catch (error) {
    console.warn("[generation] memory-context cache threw, returning empty", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      durationMs: Date.now() - cacheStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    await captureMemoryContextFallback(ctx, args, cacheStartedAt, "exception", undefined, error);
  }

  return [];
}

async function captureMemoryContextFallback(
  ctx: ActionContextLike,
  args: HydratedHitsArgs,
  cacheStartedAt: number,
  cacheStatus: string,
  errorCode?: string,
  error?: unknown,
): Promise<void> {
  const messageId = String(args.assistantMessageId ?? args.userMessageId);
  const durationMs = Date.now() - cacheStartedAt;
  const properties = {
    cache_status: cacheStatus,
    error_code: errorCode ?? null,
    user_message_id: String(args.userMessageId),
    assistant_message_id: args.assistantMessageId ? String(args.assistantMessageId) : null,
    require_zdr: args.requireZdr,
    fallback: "broad_contextual_memory",
  };
  await captureBackendAIOperationStarted(ctx, {
    userId: args.userId,
    operation: "memory_context_prewarm",
    source: "generation_memory_context",
    chatId: args.chatId ? String(args.chatId) : undefined,
    messageId,
    modelId: MODEL_IDS.embedding,
    durationMs,
    properties: {
      ...properties,
      cache_lookup_only: true,
    },
  });
  const terminalArgs = {
    userId: args.userId,
    operation: "memory_context_prewarm",
    source: "generation_memory_context",
    chatId: args.chatId ? String(args.chatId) : undefined,
    messageId,
    modelId: MODEL_IDS.embedding,
    durationMs,
    properties,
  };
  if (error !== undefined) {
    await captureBackendAIOperationFailed(ctx, {
      ...terminalArgs,
      error,
    });
  } else {
    await captureBackendAIOperationCompleted(ctx, {
      ...terminalArgs,
      properties: {
        ...properties,
        degraded: true,
      },
    });
  }
}
