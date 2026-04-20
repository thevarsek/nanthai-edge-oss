import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { formatMemoryContext } from "./helpers";
import { selectMemoriesForContext } from "./actions_memory_lifecycle";
import {
  isMemoryVisibleToPersona,
  normalizeMemoryRecord,
  prioritizeAlwaysOnMemories,
} from "../memory/shared";
import { MODEL_IDS } from "../lib/model_constants";
import { ttftLog } from "../lib/generation_log";
import { ensureMessageQueryEmbeddingReady } from "../memory/query_embedding_handlers";
import { ensureMessageMemoryContextReady } from "../memory/memory_context_handlers";

interface MemoryContextArgs {
  messages: Array<{ _id: Id<"messages">; role: string; content: string }>;
  userMessageId: Id<"messages">;
  userId: string;
  personaId?: Id<"personas"> | null;
  // M23: Optional chat attribution for embedding cost tracking.
  chatId?: Id<"chats">;
  assistantMessageId?: Id<"messages">;
}

type ActionContextLike = Pick<
  ActionCtx,
  "runQuery" | "runMutation" | "scheduler" | "vectorSearch"
>;

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

  // Phase 3: consult the prewarmed memory-context cache first. On ready hit
  // we skip embedding + vector search + hydrate entirely. On miss/failed we
  // fall back to the inline path (preserved below) so memory retrieval is
  // never silently skipped.
  const relevantMemoriesPromise = memoryQueryText.length > 0
    ? resolveHydratedHits(ctx, {
      userId: args.userId,
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageId: args.assistantMessageId,
      memoryQueryText,
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
    .map((memory: any) => normalizeMemoryRecord(memory))
    .filter((memory: any) => isMemoryVisibleToPersona(memory, args.personaId));

  const alwaysOn = prioritizeAlwaysOnMemories(
    allMemories.filter((memory: any) => memory.retrievalMode === "alwaysOn"),
    MODEL_IDS.memoryAlwaysOnLimit,
  );

  let memoryCandidates = relevantMemoriesRaw
        .map((memory: any) => normalizeMemoryRecord(memory))
        .filter(
          (memory: any) =>
            memory.retrievalMode === "contextual" &&
            isMemoryVisibleToPersona(memory, args.personaId),
        );

  if (memoryCandidates.length === 0) {
    memoryCandidates = allMemories.filter(
      (memory: any) => memory.retrievalMode === "contextual",
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
      category: memory.category,
      retrievalMode: memory.retrievalMode,
      importanceScore: memory.importanceScore,
    })),
  ) ?? "";
}

// ---------------------------------------------------------------------------
// Hydrated-hits resolver: Phase 3 cache lookup, fall back to inline compute.
// ---------------------------------------------------------------------------

interface HydratedHitsArgs {
  userId: string;
  chatId?: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageId?: Id<"messages">;
  memoryQueryText: string;
}

async function resolveHydratedHits(
  ctx: ActionContextLike,
  args: HydratedHitsArgs,
): Promise<any[]> {
  const cacheStartedAt = Date.now();
  try {
    const contextRow = await ensureMessageMemoryContextReady(ctx, {
      messageId: args.userMessageId,
      userId: args.userId,
      chatId: args.chatId,
      queryText: args.memoryQueryText,
      leaseOwner: `generation:${args.assistantMessageId ?? args.userMessageId}`,
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
      return contextRow.hydratedHits;
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
      return [];
    }

    // Unexpected: cache row neither ready nor failed after ensureReady. Fall
    // back to inline compute rather than degrade silently.
    console.warn("[generation] memory-context cache indeterminate, falling back to inline", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      durationMs: Date.now() - cacheStartedAt,
    });
  } catch (error) {
    console.warn("[generation] memory-context cache threw, falling back to inline", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      durationMs: Date.now() - cacheStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return computeHydratedHitsInline(ctx, args);
}

// ---------------------------------------------------------------------------
// Inline fallback (original implementation). Kept verbatim so cache-miss
// behavior exactly matches pre-Phase-3 behavior including logging and billing.
// ---------------------------------------------------------------------------

async function computeHydratedHitsInline(
  ctx: ActionContextLike,
  args: HydratedHitsArgs,
): Promise<any[]> {
  try {
    const embeddingStartedAt = Date.now();
    const queryEmbedding = await ensureMessageQueryEmbeddingReady(ctx, {
      messageId: args.userMessageId,
      userId: args.userId,
      chatId: args.chatId,
      queryText: args.memoryQueryText,
      leaseOwner: `generation:${args.assistantMessageId ?? args.userMessageId}`,
    });
    ttftLog("[generation] memory embedding computed (inline fallback)", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      durationMs: Date.now() - embeddingStartedAt,
      hasEmbedding: queryEmbedding?.status === "ready",
    });
    if (queryEmbedding?.status !== "ready" || !Array.isArray(queryEmbedding.embedding)) {
      return [];
    }

    const vectorSearchStartedAt = Date.now();
    const results = await ctx.vectorSearch("memoryEmbeddings", "by_embedding", {
      vector: queryEmbedding.embedding,
      limit: 12,
      filter: (q) => q.eq("userId", args.userId),
    });
    ttftLog("[generation] memory vector search completed (inline fallback)", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      durationMs: Date.now() - vectorSearchStartedAt,
      hitCount: results.length,
    });
    if (results.length === 0) {
      return [];
    }

    const hydrateStartedAt = Date.now();
    const hydrated = await ctx.runQuery(
      internal.memory.operations.hydrateRelevantMemoryHits,
      {
        hits: results.map((result) => ({
          embeddingId: result._id,
          score: result._score,
        })),
      },
    );
    ttftLog("[generation] memory hits hydrated (inline fallback)", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      durationMs: Date.now() - hydrateStartedAt,
      hydratedCount: hydrated.length,
    });

    if (queryEmbedding.usage && args.chatId && args.assistantMessageId) {
      const marked = await ctx.runMutation(
        internal.memory.operations.markMessageQueryEmbeddingUsageRecorded,
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
          promptTokens: queryEmbedding.usage.promptTokens,
          completionTokens: 0,
          totalTokens: queryEmbedding.usage.totalTokens,
          source: "memory_embedding_retrieve",
          generationId: queryEmbedding.generationId ?? undefined,
        });
      }
    }

    return hydrated;
  } catch (error) {
    console.warn("[generation] memory vector search failed, degrading gracefully", {
      userId: args.userId,
      chatId: args.chatId ?? null,
      messageId: args.assistantMessageId ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
