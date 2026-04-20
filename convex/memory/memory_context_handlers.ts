// convex/memory/memory_context_handlers.ts
// =============================================================================
// Phase 3 TTFT cache: prewarm the full memory-context retrieval chain
// (embedding + vector search + hydrate) keyed by messageId. Mirrors the
// messageQueryEmbeddings lease + prime + ensureReady pattern exactly so the
// generation action can short-circuit the entire ~660ms chain on cache hit.
//
// Critical invariant: memory retrieval is NEVER silently skipped. On cache
// miss/failure, the consumer falls back to inline compute. On timeout we
// write `status: "failed"` with a stable error code so the consumer gets
// `[]` (current graceful-degrade behavior) rather than a hang.
// =============================================================================

import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { ensureMessageQueryEmbeddingReady } from "./query_embedding_handlers";

const LEASE_DURATION_MS = 15_000;
const POLL_INTERVAL_MS = 100;
const ENSURE_READY_TIMEOUT_MS = 20_000;
const VECTOR_SEARCH_LIMIT = 12;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function getStableContextErrorCode(error: unknown): string {
  if (
    error instanceof ConvexError
    && typeof error.data?.code === "string"
    && error.data.code.trim().length > 0
  ) {
    return error.data.code.trim().toLowerCase();
  }
  return "memory_context_exception";
}

async function getQueryText(
  ctx: Pick<ActionCtx, "runQuery">,
  messageId: Id<"messages">,
  providedText?: string,
): Promise<string> {
  if (providedText !== undefined) {
    return providedText.trim();
  }
  const message = await ctx.runQuery(internal.chat.queries.getMessageInternal, {
    messageId,
  });
  return typeof message?.content === "string" ? message.content.trim() : "";
}

/**
 * Full memory-context computation: resolve the embedding (via the embedding
 * cache, which may itself poll-wait), run the user-scoped vector search, and
 * hydrate the hits. Writes the terminal row on success or failure.
 *
 * Never throws — all errors are captured and written as `status: "failed"`
 * with a stable error code. The consumer treats `failed` and missing rows
 * identically (falls back to inline compute).
 */
async function computeMemoryContextForMessage(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "scheduler" | "vectorSearch">,
  args: {
    messageId: Id<"messages">;
    userId: string;
    chatId?: Id<"chats">;
    queryText: string;
    leaseOwner: string;
  },
): Promise<void> {
  if (args.queryText.length === 0) {
    await ctx.runMutation(internal.memory.operations.completeMessageMemoryContext, {
      messageId: args.messageId,
      status: "failed",
      errorCode: "empty_query",
      now: Date.now(),
    });
    return;
  }

  try {
    // Defer to the embedding cache. If the embedding prewarm already
    // completed, this returns immediately; otherwise it poll-waits or
    // re-claims the embedding lease.
    const embeddingRow = await ensureMessageQueryEmbeddingReady(ctx, {
      messageId: args.messageId,
      userId: args.userId,
      chatId: args.chatId,
      queryText: args.queryText,
      leaseOwner: args.leaseOwner,
    });

    if (embeddingRow?.status !== "ready" || !Array.isArray(embeddingRow.embedding)) {
      await ctx.runMutation(internal.memory.operations.completeMessageMemoryContext, {
        messageId: args.messageId,
        status: "failed",
        errorCode: typeof embeddingRow?.errorCode === "string"
          ? embeddingRow.errorCode
          : "embedding_not_ready",
        now: Date.now(),
      });
      return;
    }

    const results = await ctx.vectorSearch("memoryEmbeddings", "by_embedding", {
      vector: embeddingRow.embedding,
      limit: VECTOR_SEARCH_LIMIT,
      filter: (q) => q.eq("userId", args.userId),
    });

    const hydratedHits = results.length === 0
      ? []
      : await ctx.runQuery(
        internal.memory.operations.hydrateRelevantMemoryHits,
        {
          hits: results.map((result) => ({
            embeddingId: result._id,
            score: result._score,
          })),
        },
      );

    await ctx.runMutation(internal.memory.operations.completeMessageMemoryContext, {
      messageId: args.messageId,
      status: "ready",
      hydratedHits,
      memoryQueryText: args.queryText,
      usage: embeddingRow.usage,
      generationId: embeddingRow.generationId,
      now: Date.now(),
    });
  } catch (error) {
    await ctx.runMutation(internal.memory.operations.completeMessageMemoryContext, {
      messageId: args.messageId,
      status: "failed",
      errorCode: getStableContextErrorCode(error),
      now: Date.now(),
    });
  }
}

// ---------------------------------------------------------------------------
// Query handler
// ---------------------------------------------------------------------------

export interface GetMessageMemoryContextArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getMessageMemoryContextHandler(
  ctx: QueryCtx,
  args: GetMessageMemoryContextArgs,
): Promise<any | null> {
  return await ctx.db
    .query("messageMemoryContexts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();
}

// ---------------------------------------------------------------------------
// Lease claim
// ---------------------------------------------------------------------------

export interface ClaimMessageMemoryContextLeaseArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  userId: string;
  chatId?: Id<"chats">;
  textHash: string;
  leaseOwner: string;
  leaseExpiresAt: number;
  now: number;
}

export async function claimMessageMemoryContextLeaseHandler(
  ctx: MutationCtx,
  args: ClaimMessageMemoryContextLeaseArgs,
): Promise<{ claimed: boolean; status: "pending" | "ready" | "failed" }> {
  const existing = await ctx.db
    .query("messageMemoryContexts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();

  if (!existing) {
    await ctx.db.insert("messageMemoryContexts", {
      messageId: args.messageId,
      userId: args.userId,
      chatId: args.chatId,
      status: "pending",
      textHash: args.textHash,
      leaseOwner: args.leaseOwner,
      leaseExpiresAt: args.leaseExpiresAt,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { claimed: true, status: "pending" };
  }

  // If the cached row matches the current text and is ready, use it.
  if (existing.status === "ready" && existing.textHash === args.textHash) {
    return { claimed: false, status: "ready" };
  }

  // Another worker holds a live lease for the same text — back off.
  if (
    existing.status === "pending"
    && existing.textHash === args.textHash
    && existing.leaseExpiresAt
    && existing.leaseExpiresAt > args.now
    && existing.leaseOwner !== args.leaseOwner
  ) {
    return { claimed: false, status: "pending" };
  }

  // Otherwise: stale text, failed, expired lease, or our own re-entry.
  // Take over, reset all payload fields.
  await ctx.db.patch(existing._id, {
    userId: args.userId,
    chatId: args.chatId,
    status: "pending",
    hydratedHits: undefined,
    memoryQueryText: undefined,
    usage: undefined,
    generationId: undefined,
    errorCode: undefined,
    leaseOwner: args.leaseOwner,
    leaseExpiresAt: args.leaseExpiresAt,
    textHash: args.textHash,
    updatedAt: args.now,
  });
  return { claimed: true, status: "pending" };
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export interface CompleteMessageMemoryContextArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  status: "ready" | "failed";
  hydratedHits?: any[];
  memoryQueryText?: string;
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
  generationId?: string;
  errorCode?: string;
  now: number;
}

export async function completeMessageMemoryContextHandler(
  ctx: MutationCtx,
  args: CompleteMessageMemoryContextArgs,
): Promise<void> {
  const existing = await ctx.db
    .query("messageMemoryContexts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();
  if (!existing) return;
  // Do not downgrade a ready row to failed — a late-arriving failure from a
  // retried worker must never clobber a good cache hit.
  if (existing.status === "ready" && args.status === "failed") return;

  await ctx.db.patch(existing._id, {
    status: args.status,
    hydratedHits: args.status === "ready" ? (args.hydratedHits ?? []) : undefined,
    memoryQueryText: args.status === "ready" ? args.memoryQueryText : undefined,
    usage: args.status === "ready" ? args.usage : undefined,
    generationId: args.status === "ready" ? args.generationId : undefined,
    errorCode: args.status === "failed" ? args.errorCode : undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: args.now,
  });
}

// ---------------------------------------------------------------------------
// Usage billing guard
// ---------------------------------------------------------------------------

export interface MarkMessageMemoryContextUsageRecordedArgs
  extends Record<string, unknown> {
  messageId: Id<"messages">;
  usageRecordedAt: number;
  usageRecordedMessageId: Id<"messages">;
}

export async function markMessageMemoryContextUsageRecordedHandler(
  ctx: MutationCtx,
  args: MarkMessageMemoryContextUsageRecordedArgs,
): Promise<boolean> {
  const existing = await ctx.db
    .query("messageMemoryContexts")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();
  if (!existing?.usage || existing.usageRecordedAt) {
    return false;
  }

  await ctx.db.patch(existing._id, {
    usageRecordedAt: args.usageRecordedAt,
    usageRecordedMessageId: args.usageRecordedMessageId,
    updatedAt: args.usageRecordedAt,
  });
  return true;
}

// ---------------------------------------------------------------------------
// Prime (fire-and-forget from sendMessage / retry)
// ---------------------------------------------------------------------------

export interface PrimeMessageMemoryContextArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  userId: string;
  chatId?: Id<"chats">;
  queryText?: string;
}

export async function primeMessageMemoryContextHandler(
  ctx: ActionCtx,
  args: PrimeMessageMemoryContextArgs,
): Promise<void> {
  const queryText = await getQueryText(ctx, args.messageId, args.queryText);
  const leaseOwner = `prime:${args.messageId}`;
  const claim = await ctx.runMutation(
    internal.memory.operations.claimMessageMemoryContextLease,
    {
      messageId: args.messageId,
      userId: args.userId,
      chatId: args.chatId,
      textHash: hashText(queryText),
      leaseOwner,
      leaseExpiresAt: Date.now() + LEASE_DURATION_MS,
      now: Date.now(),
    },
  );
  if (!claim.claimed) {
    return;
  }

  await computeMemoryContextForMessage(ctx, {
    messageId: args.messageId,
    userId: args.userId,
    chatId: args.chatId,
    queryText,
    leaseOwner,
  });
}

// ---------------------------------------------------------------------------
// Ensure ready (critical-path poll-wait used by the generation action)
// ---------------------------------------------------------------------------

export async function ensureMessageMemoryContextReady(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "scheduler" | "vectorSearch">,
  args: {
    messageId: Id<"messages">;
    userId: string;
    chatId?: Id<"chats">;
    queryText: string;
    leaseOwner: string;
  },
): Promise<any | null> {
  const textHash = hashText(args.queryText);
  const deadline = Date.now() + ENSURE_READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const row = await ctx.runQuery(
      internal.memory.operations.getMessageMemoryContext,
      { messageId: args.messageId },
    );
    // Only honor ready/failed rows whose textHash matches the current query.
    // Stale rows (edited message) must be recomputed.
    if (row?.status === "ready" && row?.textHash === textHash) return row;
    if (row?.status === "failed" && row?.textHash === textHash) return row;

    const now = Date.now();
    const claim = await ctx.runMutation(
      internal.memory.operations.claimMessageMemoryContextLease,
      {
        messageId: args.messageId,
        userId: args.userId,
        chatId: args.chatId,
        textHash,
        leaseOwner: args.leaseOwner,
        leaseExpiresAt: now + LEASE_DURATION_MS,
        now,
      },
    );

    if (claim.claimed) {
      await computeMemoryContextForMessage(ctx, {
        messageId: args.messageId,
        userId: args.userId,
        chatId: args.chatId,
        queryText: args.queryText,
        leaseOwner: args.leaseOwner,
      });
      continue;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const finalRow = await ctx.runQuery(
    internal.memory.operations.getMessageMemoryContext,
    { messageId: args.messageId },
  );
  if (
    (finalRow?.status === "ready" || finalRow?.status === "failed")
    && finalRow.textHash === textHash
  ) {
    return finalRow;
  }

  await ctx.runMutation(internal.memory.operations.completeMessageMemoryContext, {
    messageId: args.messageId,
    status: "failed",
    errorCode: "memory_context_wait_timeout",
    now: Date.now(),
  });
  return await ctx.runQuery(
    internal.memory.operations.getMessageMemoryContext,
    { messageId: args.messageId },
  );
}
