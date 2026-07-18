import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { formatMemoryContext } from "./helpers";
import { selectMemoriesForContext } from "./actions_memory_lifecycle";
import {
  isMemoryActive,
  isMemoryVisibleToPersona,
  type MemoryRecordLike,
  normalizeMemoryRecord,
  prioritizeAlwaysOnMemories,
} from "../memory/shared";
import { MODEL_IDS } from "../lib/model_constants";
import { ttftLog } from "../lib/generation_log";
import { ensureMessageMemoryContextReady } from "../memory/memory_context_handlers";
import {
  captureBackendAIOperationCompleted,
  captureBackendAIOperationFailed,
  captureBackendAIOperationStarted,
} from "../analytics/backend_events";

const GENERATION_MEMORY_CONTEXT_WAIT_MS = 250;

interface MemoryContextArgs {
  messages: Array<{ _id: Id<"messages">; role: string; content: string }>;
  userMessageId: Id<"messages">;
  userId: string;
  personaId?: Id<"personas"> | null;
  // M23: Optional chat attribution for embedding cost tracking.
  chatId?: Id<"chats">;
  assistantMessageId?: Id<"messages">;
  requireZdr?: boolean;
}

type ActionContextLike = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "scheduler" | "vectorSearch"
>;

type NormalizedMemory = ReturnType<typeof normalizeMemoryRecord>;

export async function resolveMemoryContextForGeneration(
  ctx: ActionContextLike,
  args: MemoryContextArgs,
): Promise<string> {
  const resolutionStartedAt = Date.now();
  const promptUserMessage = args.messages.find(
    (message) => message._id === args.userMessageId && message.role === "user",
  );
  const fallbackUserMessage = args.messages
    .slice()
    .reverse()
    .find((message) => message.role === "user");
  const memoryQueryText =
    promptUserMessage?.content?.trim() ??
    fallbackUserMessage?.content?.trim() ??
    "";
  const allMemoriesPromise = ctx.runQuery(
    internal.chat.queries.getUserMemories,
    { userId: args.userId },
  );

  // Consult the prewarmed memory-context cache. A ready hit avoids embedding,
  // vector search, and hydration on the generation path; any miss degrades to
  // broad contextual memory instead of blocking TTFT with inline retrieval.
  const relevantMemoriesPromise = memoryQueryText.length > 0
    ? resolveHydratedHits(ctx, {
      userId: args.userId,
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageId: args.assistantMessageId,
      memoryQueryText,
      requireZdr: args.requireZdr === true,
    })
    : Promise.resolve([]);

  const [allMemoriesRaw, relevantMemoriesRaw] = await Promise.all([
    allMemoriesPromise,
    relevantMemoriesPromise,
  ]);
  ttftLog("[generation] memory base query loaded", {
    userId: args.userId,
    chatId: args.chatId ?? null,
    messageId: args.assistantMessageId ?? null,
    durationMs: Date.now() - resolutionStartedAt,
    memoryCount: allMemoriesRaw.length,
  });

  const allMemories = allMemoriesRaw
    .map((memory: MemoryRecordLike) => normalizeMemoryRecord(memory))
    .filter((memory: NormalizedMemory) => isMemoryActive(memory))
    .filter((memory: NormalizedMemory) => isMemoryVisibleToPersona(memory, args.personaId));

  const alwaysOn = prioritizeAlwaysOnMemories(
    allMemories.filter((memory: NormalizedMemory) => memory.retrievalMode === "alwaysOn"),
    MODEL_IDS.memoryAlwaysOnLimit,
  );

  let memoryCandidates = relevantMemoriesRaw
        .map((memory: MemoryRecordLike) => normalizeMemoryRecord(memory))
        .filter(
          (memory: NormalizedMemory) =>
            memory.retrievalMode === "contextual" &&
            isMemoryVisibleToPersona(memory, args.personaId),
        );

  if (memoryCandidates.length === 0) {
    memoryCandidates = allMemories.filter(
      (memory: NormalizedMemory) => memory.retrievalMode === "contextual",
    );
  }

  const contextual = selectMemoriesForContext(
    memoryCandidates,
    memoryQueryText,
    12,
  );
  const selected = [
    ...alwaysOn,
    ...contextual.filter(
      (memory) => !alwaysOn.some((alwaysOnMemory) => alwaysOnMemory._id === memory._id),
    ),
  ];

  const selectedIds = selected
    .map((memory) => memory._id)
    .filter((id): id is Id<"memories"> => typeof id === "string");
  if (selectedIds.length > 0) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.touchMemories, {
      memoryIds: selectedIds,
      touchedAt: Date.now(),
    });
    ttftLog("[generation] memories touched (scheduled)", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      touchedCount: selectedIds.length,
    });
  }

  return formatMemoryContext(
    selected.map((memory) => ({
      content: memory.content,
      isPinned: memory.isPinned ?? false,
      memoryType: memory.memoryType,
      category: "category" in memory ? memory.category : undefined,
      retrievalMode: "retrievalMode" in memory ? memory.retrievalMode : undefined,
      importanceScore: memory.importanceScore,
    })),
  ) ?? "";
}

// ---------------------------------------------------------------------------
// Hydrated-hits resolver: short cache wait, then broad contextual fallback.
// ---------------------------------------------------------------------------

interface HydratedHitsArgs {
  userId: string;
  chatId?: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageId?: Id<"messages">;
  memoryQueryText: string;
  requireZdr: boolean;
}

async function resolveHydratedHits(
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
      if (contextRow.usage && args.chatId && args.assistantMessageId) {
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
