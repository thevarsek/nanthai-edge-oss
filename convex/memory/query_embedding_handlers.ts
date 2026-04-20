import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { ConvexError } from "convex/values";
import { computeEmbedding } from "./embedding_helpers";

const PRIMARY_PROVIDER = "openrouter" as const;
const LEASE_DURATION_MS = 15_000;
const POLL_INTERVAL_MS = 100;
const ENSURE_READY_TIMEOUT_MS = 20_000;

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

async function computePrimaryEmbeddingForMessage(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "scheduler">,
  args: {
    messageId: Id<"messages">;
    userId: string;
    chatId?: Id<"chats">;
    queryText: string;
  },
): Promise<void> {
  const now = Date.now();
  if (args.queryText.length === 0) {
    await ctx.runMutation(internal.memory.operations.completeMessageQueryEmbedding, {
      messageId: args.messageId,
      status: "failed",
      errorCode: "empty_query",
      now,
    });
    return;
  }

  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const embeddingResult = await computeEmbedding(args.queryText, apiKey);
    await ctx.runMutation(internal.memory.operations.completeMessageQueryEmbedding, {
      messageId: args.messageId,
      status: embeddingResult ? "ready" : "failed",
      embedding: embeddingResult?.embedding,
      usage: embeddingResult?.usage,
      generationId: embeddingResult?.generationId,
      errorCode: embeddingResult ? undefined : "primary_embedding_failed",
      now: Date.now(),
    });
  } catch (error) {
    await ctx.runMutation(internal.memory.operations.completeMessageQueryEmbedding, {
      messageId: args.messageId,
      status: "failed",
      errorCode: getStableEmbeddingErrorCode(error),
      now: Date.now(),
    });
  }
}

export interface GetMessageQueryEmbeddingArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getMessageQueryEmbeddingHandler(
  ctx: QueryCtx,
  args: GetMessageQueryEmbeddingArgs,
): Promise<any | null> {
  return await ctx.db
    .query("messageQueryEmbeddings")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();
}

export interface ClaimMessageQueryEmbeddingLeaseArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  userId: string;
  chatId?: Id<"chats">;
  textHash: string;
  leaseOwner: string;
  leaseExpiresAt: number;
  now: number;
}

export async function claimMessageQueryEmbeddingLeaseHandler(
  ctx: MutationCtx,
  args: ClaimMessageQueryEmbeddingLeaseArgs,
): Promise<{ claimed: boolean; status: "pending" | "ready" | "failed" }> {
  const existing = await ctx.db
    .query("messageQueryEmbeddings")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();

  if (!existing) {
    await ctx.db.insert("messageQueryEmbeddings", {
      messageId: args.messageId,
      userId: args.userId,
      chatId: args.chatId,
      provider: PRIMARY_PROVIDER,
      modelId: MODEL_IDS.embedding,
      status: "pending",
      textHash: args.textHash,
      leaseOwner: args.leaseOwner,
      leaseExpiresAt: args.leaseExpiresAt,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { claimed: true, status: "pending" };
  }

  if (existing.status === "ready") {
    return { claimed: false, status: "ready" };
  }

  if (
    existing.status === "pending"
    && existing.leaseExpiresAt
    && existing.leaseExpiresAt > args.now
    && existing.leaseOwner !== args.leaseOwner
  ) {
    return { claimed: false, status: "pending" };
  }

  await ctx.db.patch(existing._id, {
    userId: args.userId,
    chatId: args.chatId,
    provider: PRIMARY_PROVIDER,
    modelId: MODEL_IDS.embedding,
    status: "pending",
    embedding: undefined,
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

export interface CompleteMessageQueryEmbeddingArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  status: "ready" | "failed";
  embedding?: number[];
  usage?: {
    promptTokens: number;
    totalTokens: number;
  };
  generationId?: string;
  errorCode?: string;
  now: number;
}

export async function completeMessageQueryEmbeddingHandler(
  ctx: MutationCtx,
  args: CompleteMessageQueryEmbeddingArgs,
): Promise<void> {
  const existing = await ctx.db
    .query("messageQueryEmbeddings")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .first();
  if (!existing) return;
  if (existing.status === "ready" && args.status === "failed") return;

  await ctx.db.patch(existing._id, {
    status: args.status,
    embedding: args.status === "ready" ? args.embedding : undefined,
    usage: args.status === "ready" ? args.usage : undefined,
    generationId: args.status === "ready" ? args.generationId : undefined,
    errorCode: args.status === "failed" ? args.errorCode : undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    updatedAt: args.now,
  });
}

export interface MarkMessageQueryEmbeddingUsageRecordedArgs
  extends Record<string, unknown> {
  messageId: Id<"messages">;
  usageRecordedAt: number;
  usageRecordedMessageId: Id<"messages">;
}

export async function markMessageQueryEmbeddingUsageRecordedHandler(
  ctx: MutationCtx,
  args: MarkMessageQueryEmbeddingUsageRecordedArgs,
): Promise<boolean> {
  const existing = await ctx.db
    .query("messageQueryEmbeddings")
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

export interface PrimeMessageQueryEmbeddingArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  userId: string;
  chatId?: Id<"chats">;
  queryText?: string;
}

export async function primeMessageQueryEmbeddingHandler(
  ctx: ActionCtx,
  args: PrimeMessageQueryEmbeddingArgs,
): Promise<void> {
  const queryText = await getQueryText(ctx, args.messageId, args.queryText);
  const claim = await ctx.runMutation(
    internal.memory.operations.claimMessageQueryEmbeddingLease,
    {
      messageId: args.messageId,
      userId: args.userId,
      chatId: args.chatId,
      textHash: hashText(queryText),
      leaseOwner: `prime:${args.messageId}`,
      leaseExpiresAt: Date.now() + LEASE_DURATION_MS,
      now: Date.now(),
    },
  );
  if (!claim.claimed) {
    return;
  }

  await computePrimaryEmbeddingForMessage(ctx, {
    messageId: args.messageId,
    userId: args.userId,
    chatId: args.chatId,
    queryText,
  });
}

export async function ensureMessageQueryEmbeddingReady(
  ctx: Pick<ActionCtx, "runMutation" | "runQuery" | "scheduler">,
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
    const row = await ctx.runQuery(internal.memory.operations.getMessageQueryEmbedding, {
      messageId: args.messageId,
    });
    if (row?.status === "ready") return row;
    if (row?.status === "failed") return row;

    const now = Date.now();
    const claim = await ctx.runMutation(
      internal.memory.operations.claimMessageQueryEmbeddingLease,
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
      await computePrimaryEmbeddingForMessage(ctx, {
        messageId: args.messageId,
        userId: args.userId,
        chatId: args.chatId,
        queryText: args.queryText,
      });
      continue;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  const finalRow = await ctx.runQuery(internal.memory.operations.getMessageQueryEmbedding, {
    messageId: args.messageId,
  });
  if (finalRow?.status === "ready" || finalRow?.status === "failed") {
    return finalRow;
  }

  await ctx.runMutation(internal.memory.operations.completeMessageQueryEmbedding, {
    messageId: args.messageId,
    status: "failed",
    errorCode: "embedding_wait_timeout",
    now: Date.now(),
  });
  return await ctx.runQuery(internal.memory.operations.getMessageQueryEmbedding, {
    messageId: args.messageId,
  });
}
