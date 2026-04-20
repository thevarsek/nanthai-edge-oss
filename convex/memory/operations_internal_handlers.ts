import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  ActionCtx,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import { computeEmbedding, jaccardSimilarity } from "./embedding_helpers";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { MODEL_IDS } from "../lib/model_constants";

export interface RetrieveRelevantArgs extends Record<string, unknown> {
  queryText: string;
  userId: string;
  limit?: number;
  // M23: Optional chat attribution for embedding cost tracking.
  chatId?: Id<"chats">;
  messageId?: Id<"messages">;
}

// ✅ userId added to memoryEmbeddings schema and vector index filterFields.
// retrieveRelevantHandler now filters by userId directly — no overfetch needed.
// Run backfillEmbeddingUserIds migration to populate existing rows
// (all new rows are written with userId).

export async function retrieveRelevantHandler(
  ctx: ActionCtx,
  args: RetrieveRelevantArgs,
): Promise<Array<any>> {
  if (!args.queryText.trim()) return [];

  const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
  const embeddingResult = await computeEmbedding(args.queryText, apiKey);
  if (!embeddingResult) return [];

  const requestedLimit = args.limit ?? 10;

  // Filter by userId directly in the vector index — no overfetch needed.
  // Pre-migration rows without userId are excluded by the filter; the
  // backfillEmbeddingUserIds migration populates them so they become searchable.
  const results = await ctx.vectorSearch("memoryEmbeddings", "by_embedding", {
    vector: embeddingResult.embedding,
    limit: Math.min(requestedLimit, 256),
    filter: (q) => q.eq("userId", args.userId),
  });
  if (results.length === 0) return [];

  const memories = [];
  for (const result of results) {
    if (memories.length >= requestedLimit) break;

    const embeddingDoc = await ctx.runQuery(
      internal.memory.operations.getEmbeddingDoc,
      { embeddingId: result._id },
    );
    if (!embeddingDoc) continue;

    const memory = await ctx.runQuery(internal.memory.operations.getMemoryDoc, {
      memoryId: embeddingDoc.memoryId,
    });
    if (memory) {
      memories.push({
        ...memory,
        score: result._score,
      });
    }
  }

  // M23: Track embedding retrieval cost if chat attribution is available.
  if (embeddingResult.usage && args.chatId && args.messageId) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
      messageId: args.messageId,
      chatId: args.chatId,
      userId: args.userId,
      modelId: MODEL_IDS.embedding,
      promptTokens: embeddingResult.usage.promptTokens,
      completionTokens: 0,
      totalTokens: embeddingResult.usage.totalTokens,
      source: "memory_embedding_retrieve",
      generationId: embeddingResult.generationId ?? undefined,
    });
  }

  return memories;
}

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

  const apiKey = await getRequiredUserOpenRouterApiKey(ctx, memory.userId);
  const embeddingResult = await computeEmbedding(args.content, apiKey);
  if (!embeddingResult) return;

  await ctx.runMutation(internal.memory.operations.storeEmbedding, {
    memoryId: args.memoryId,
    userId: memory.userId,
    embedding: embeddingResult.embedding,
  });

  // M23: Track embedding cost if the memory has chat attribution.
  if (embeddingResult.usage && memory.sourceChatId && memory.sourceMessageId) {
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

export interface GetEmbeddingDocArgs extends Record<string, unknown> {
  embeddingId: Id<"memoryEmbeddings">;
}

export async function getEmbeddingDocHandler(
  ctx: QueryCtx,
  args: GetEmbeddingDocArgs,
): Promise<any | null> {
  return await ctx.db.get(args.embeddingId);
}

export interface GetMemoryDocArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
}

export async function getMemoryDocHandler(
  ctx: QueryCtx,
  args: GetMemoryDocArgs,
): Promise<any | null> {
  return await ctx.db.get(args.memoryId);
}

export interface HydrateRelevantMemoryHitsArgs extends Record<string, unknown> {
  hits: Array<{
    embeddingId: Id<"memoryEmbeddings">;
    score: number;
  }>;
}

export async function hydrateRelevantMemoryHitsHandler(
  ctx: QueryCtx,
  args: HydrateRelevantMemoryHitsArgs,
): Promise<Array<any>> {
  const hydrated: Array<any> = [];

  for (const hit of args.hits) {
    const embeddingDoc = await ctx.db.get(hit.embeddingId);
    if (!embeddingDoc) continue;

    const memory = await ctx.db.get(embeddingDoc.memoryId);
    if (!memory) continue;

    hydrated.push({
      ...memory,
      score: hit.score,
    });
  }

  return hydrated;
}

export interface StoreEmbeddingArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
  userId: string;
  embedding: number[];
}

export async function storeEmbeddingHandler(
  ctx: MutationCtx,
  args: StoreEmbeddingArgs,
): Promise<void> {
  const existing = await ctx.db
    .query("memoryEmbeddings")
    .withIndex("by_memory", (q) => q.eq("memoryId", args.memoryId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, { embedding: args.embedding, userId: args.userId });
    return;
  }

  await ctx.db.insert("memoryEmbeddings", {
    memoryId: args.memoryId,
    userId: args.userId,
    embedding: args.embedding,
  });
}

const PURGE_BATCH_SIZE = 200;

export interface PurgeUserMemoriesBatchArgs extends Record<string, unknown> {
  userId: string;
}

export async function purgeUserMemoriesBatchHandler(
  ctx: MutationCtx,
  args: PurgeUserMemoriesBatchArgs,
): Promise<number> {
  const memories = await ctx.db
    .query("memories")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .take(PURGE_BATCH_SIZE);

  for (const memory of memories) {
    const embedding = await ctx.db
      .query("memoryEmbeddings")
      .withIndex("by_memory", (q) => q.eq("memoryId", memory._id))
      .first();
    if (embedding) {
      await ctx.db.delete(embedding._id);
    }
    await ctx.db.delete(memory._id);
  }

  return memories.length;
}

export interface PurgeUserMemoriesArgs extends Record<string, unknown> {
  userId: string;
}

export async function purgeUserMemoriesHandler(
  ctx: ActionCtx,
  args: PurgeUserMemoriesArgs,
): Promise<void> {
  let deleted = 0;
  do {
    deleted = await ctx.runMutation(
      internal.memory.operations.purgeUserMemoriesBatch,
      { userId: args.userId },
    );
  } while (deleted >= PURGE_BATCH_SIZE);
}

// ---------------------------------------------------------------------------
// Memory consolidation — user-isolated, category-grouped, paginated
// ---------------------------------------------------------------------------

/**
 * Number of memories to compare per mutation invocation. Kept well below the
 * Convex per-transaction document-read limit (~8 000) to avoid timeouts even
 * on worst-case pairwise comparisons.
 */
const CONSOLIDATION_USER_BATCH = 300;

/**
 * Collect distinct userIds that have at least one memory.
 * Returns up to 500 unique userIds (more than enough for daily cron).
 */
export async function getDistinctMemoryUserIdsHandler(
  ctx: QueryCtx,
): Promise<string[]> {
  // Scan the by_user index which is ordered by (userId, createdAt).
  // We only need distinct userIds, so skip forward once we see a new userId.
  const userIds: string[] = [];
  let lastUserId: string | null = null;
  // Paginate through the table in chunks to avoid scanning the full table
  // in a single take() — we stop early once we have enough users.
  const PAGE_SIZE = 200;
  let cursor: string | undefined;
  let done = false;

  while (!done && userIds.length < 500) {
    const page = cursor
      ? await ctx.db
          .query("memories")
          .withIndex("by_user", (q) => q.gt("userId", cursor!))
          .take(PAGE_SIZE)
      : await ctx.db
          .query("memories")
          .withIndex("by_user")
          .take(PAGE_SIZE);

    if (page.length === 0) break;

    for (const memory of page) {
      if (memory.userId !== lastUserId) {
        userIds.push(memory.userId);
        lastUserId = memory.userId;
        cursor = memory.userId;
      }
    }

    // If the page was smaller than PAGE_SIZE we've exhausted the table.
    if (page.length < PAGE_SIZE) done = true;
  }

  return userIds;
}

/**
 * Consolidate duplicate memories for a single user — one page at a time.
 *
 * Strategy:
 * 1. Query this user's memories using the `by_user` index (user isolation),
 *    paginating via cursor so ALL memories are eventually considered.
 * 2. Group by `memoryType` so comparisons only happen within the same category.
 * 3. Within each category, compare pairs using Jaccard similarity (> 0.8 = dup).
 * 4. Uses a Set for O(1) deletion lookups instead of Array.includes (was O(n)).
 *
 * Returns { deleted, isDone, nextCursor }. The caller (consolidateHandler)
 * must loop, passing nextCursor each time, until isDone is true.
 */
export async function consolidateForUserHandler(
  ctx: MutationCtx,
  args: { userId: string; cursor?: string },
): Promise<{ deleted: number; isDone: boolean; nextCursor?: string }> {
  const page = await ctx.db
    .query("memories")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .paginate({ cursor: args.cursor ?? null, numItems: CONSOLIDATION_USER_BATCH });

  if (page.page.length === 0) return { deleted: 0, isDone: true };

  // Group by memoryType so we only compare within the same category.
  const byType = new Map<string, typeof page.page>();
  for (const memory of page.page) {
    const type = memory.memoryType ?? "unknown";
    const list = byType.get(type) ?? [];
    list.push(memory);
    byType.set(type, list);
  }

  const toDelete = new Set<Id<"memories">>();

  for (const [, typeMemories] of byType) {
    for (let i = 0; i < typeMemories.length; i += 1) {
      if (toDelete.has(typeMemories[i]._id)) continue;

      for (let j = i + 1; j < typeMemories.length; j += 1) {
        if (toDelete.has(typeMemories[j]._id)) continue;

        const similarity = jaccardSimilarity(
          typeMemories[i].content,
          typeMemories[j].content,
        );

        if (similarity > 0.8) {
          // Delete the older duplicate, keep the newer one.
          const older =
            typeMemories[i].createdAt < typeMemories[j].createdAt
              ? typeMemories[i]
              : typeMemories[j];
          toDelete.add(older._id);
        }
      }
    }
  }

  for (const id of toDelete) {
    const embedding = await ctx.db
      .query("memoryEmbeddings")
      .withIndex("by_memory", (q) => q.eq("memoryId", id))
      .first();
    if (embedding) await ctx.db.delete(embedding._id);
    await ctx.db.delete(id);
  }

  return {
    deleted: toDelete.size,
    isDone: page.isDone,
    nextCursor: page.isDone ? undefined : page.continueCursor,
  };
}

/**
 * Top-level consolidation action (called by cron).
 *
 * Iterates over distinct users, calling a per-user mutation for each page of
 * memories until all memories have been considered. Each page is processed in
 * its own mutation transaction, keeping transaction sizes small and avoiding
 * cross-user data loading. Paginates through ALL memories per user so users
 * with more than CONSOLIDATION_USER_BATCH memories are fully covered.
 */
export async function consolidateHandler(ctx: ActionCtx): Promise<void> {
  const userIds: string[] = await ctx.runQuery(
    internal.memory.operations.getDistinctMemoryUserIds,
    {},
  );

  let totalConsolidated = 0;
  for (const userId of userIds) {
    let cursor: string | undefined;
    do {
      const result: { deleted: number; isDone: boolean; nextCursor?: string } =
        await ctx.runMutation(
          internal.memory.operations.consolidateForUser,
          { userId, cursor },
        );
      totalConsolidated += result.deleted;
      cursor = result.nextCursor;
      if (result.isDone) break;
    } while (cursor !== undefined);
  }

  if (totalConsolidated > 0) {
    console.log(
      `Memory consolidation: removed ${totalConsolidated} duplicates across ${userIds.length} users`,
    );
  }
}
