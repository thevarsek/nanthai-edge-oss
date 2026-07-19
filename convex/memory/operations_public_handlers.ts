import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { requireAuth, requirePro } from "../lib/auth";
import {
  deleteMemoryWithDerivedData,
} from "./cleanup";
import {
  normalizeMemoryRecord,
  normalizeMemoryScopeType,
  type MemoryCategory,
  type MemoryRetrievalMode,
} from "./shared";
import { refreshMemoryEmbedding } from "./operations_embedding_refresh";

type NormalizedMemoryRecord = ReturnType<typeof normalizeMemoryRecord>;

function isActiveMemory(memory: { isSuperseded?: boolean; expiresAt?: number }, now: number): boolean {
  if (memory.isSuperseded) return false;
  if (typeof memory.expiresAt === "number" && memory.expiresAt <= now) return false;
  return true;
}

async function assertOwnedMemory(
  ctx: MutationCtx,
  memoryId: Id<"memories">,
  userId: string,
) {
  const memory = await ctx.db.get(memoryId);
  if (!memory || memory.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Memory not found or unauthorized" });
  }
  return memory;
}

export interface ListArgs extends Record<string, unknown> {
  limit?: number;
  pinnedOnly?: boolean;
}

export async function listHandler(
  ctx: QueryCtx,
  args: ListArgs,
): Promise<NormalizedMemoryRecord[]> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  const limit = Math.min(Math.max(Math.floor(args.limit ?? 500), 1), 500);
  const fetchLimit = Math.max(limit * 3, 150);

  const records = args.pinnedOnly
    ? await ctx.db
      .query("memories")
      .withIndex("by_user_pinned", (q) => q.eq("userId", userId).eq("isPinned", true))
      .take(fetchLimit)
    : await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(fetchLimit);

  return records
    .filter((memory) => isActiveMemory(memory, now))
    .map((memory) => normalizeMemoryRecord(memory))
    .slice(0, limit);
}

export interface TogglePinArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
}

export async function togglePinHandler(
  ctx: MutationCtx,
  args: TogglePinArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const memory = await assertOwnedMemory(ctx, args.memoryId, userId);

  await ctx.db.patch(args.memoryId, {
    isPinned: !memory.isPinned,
    updatedAt: Date.now(),
  });
}

export interface RemoveArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
}

export async function removeHandler(
  ctx: MutationCtx,
  args: RemoveArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  await assertOwnedMemory(ctx, args.memoryId, userId);
  await deleteMemoryWithDerivedData(ctx, args.memoryId, userId);
}

export interface ApproveArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
}

export async function approveHandler(
  ctx: MutationCtx,
  args: ApproveArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  await assertOwnedMemory(ctx, args.memoryId, userId);

  await ctx.db.patch(args.memoryId, {
    isPending: false,
    updatedAt: Date.now(),
  });
}

export interface RejectArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
}

export async function rejectHandler(
  ctx: MutationCtx,
  args: RejectArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  await assertOwnedMemory(ctx, args.memoryId, userId);
  await deleteMemoryWithDerivedData(ctx, args.memoryId, userId);
}

export interface UpdateArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
  content?: string;
  category?: MemoryCategory | null;
  retrievalMode?: MemoryRetrievalMode;
  scopeType?: "allPersonas" | "selectedPersonas";
  personaIds?: string[];
  tags?: string[];
  isPinned?: boolean;
}

export async function updateHandler(
  ctx: MutationCtx,
  args: UpdateArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const memory = normalizeMemoryRecord(await assertOwnedMemory(ctx, args.memoryId, userId));

  const content = args.content?.trim() ?? memory.content;
  if (!content) {
    throw new ConvexError({ code: "VALIDATION", message: "Memory content cannot be empty" });
  }
  const rawPersonaIds = args.personaIds ?? memory.personaIds;
  const scopeType = normalizeMemoryScopeType(args.scopeType ?? memory.scopeType, rawPersonaIds);
  const personaIds = scopeType === "allPersonas" ? [] : rawPersonaIds;
  const tags = (args.tags ?? memory.tags).map((tag) => tag.trim()).filter(Boolean);
  const category = Object.hasOwn(args, "category")
    ? (args.category ?? undefined)
    : memory.category;

  await ctx.db.patch(args.memoryId, {
    content,
    category,
    retrievalMode: args.retrievalMode ?? memory.retrievalMode,
    scopeType,
    personaIds,
    tags,
    relationshipsBuiltAt: undefined,
    ...(args.isPinned !== undefined ? { isPinned: args.isPinned } : {}),
    updatedAt: Date.now(),
  });

  await refreshMemoryEmbedding(ctx, args.memoryId, userId, content);
}

export interface CreateManualArgs extends Record<string, unknown> {
  content: string;
  category?: MemoryCategory;
  retrievalMode?: MemoryRetrievalMode;
  scopeType?: "allPersonas" | "selectedPersonas";
  personaIds?: string[];
  tags?: string[];
  isPinned?: boolean;
}

export async function createManualHandler(
  ctx: MutationCtx,
  args: CreateManualArgs,
): Promise<Id<"memories">> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  const normalized = normalizeMemoryRecord({
    content: args.content.trim(),
    category: args.category,
    retrievalMode: args.retrievalMode,
    scopeType: args.scopeType,
    personaIds: args.personaIds,
    sourceType: "manual",
    tags: args.tags,
  });
  if (!normalized.content) throw new ConvexError({ code: "VALIDATION", message: "Memory content cannot be empty" });

  const memoryId = await ctx.db.insert("memories", {
    userId,
    content: normalized.content,
    category: normalized.category,
    memoryType: normalized.category === "writingStyle" ? "responsePreference" : "profile",
    retrievalMode: normalized.retrievalMode,
    scopeType: normalized.scopeType,
    personaIds: normalized.personaIds,
    sourceType: "manual",
    sourceFileName: undefined,
    tags: normalized.tags,
    sourceMessageId: undefined,
    sourceChatId: undefined,
    isPinned: args.isPinned ?? false,
    isPending: false,
    accessCount: 0,
    importanceScore: 0.95,
    confidenceScore: 0.98,
    reinforcementCount: 1,
    lastReinforcedAt: now,
    isSuperseded: false,
    createdAt: now,
    updatedAt: now,
  });

  await refreshMemoryEmbedding(ctx, memoryId, userId, normalized.content);
  return memoryId;
}

export async function deleteAllHandler(ctx: MutationCtx): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  // Process a single batch per mutation. Workpool provides bounded,
  // retryable continuation without building a scheduler chain.
  const BATCH_SIZE = 100;
  const batch = await ctx.db
    .query("memories")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(BATCH_SIZE);
  for (const memory of batch) {
    await deleteMemoryWithDerivedData(ctx, memory._id, userId);
  }
  if (batch.length === BATCH_SIZE) {
    await ctx.runMutation(internal.execution.maintenance_bulk_queues.enqueueMemoryBulkDelete, { userId });
  }
}

export async function approveAllHandler(ctx: MutationCtx): Promise<number> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  // Single batch per mutation with a Workpool continuation.
  const BATCH_SIZE = 100;
  const batch = await ctx.db
    .query("memories")
    .withIndex("by_user_pending", (q) => q.eq("userId", userId).eq("isPending", true))
    .take(BATCH_SIZE);
  for (const memory of batch) {
    await ctx.db.patch(memory._id, { isPending: false, updatedAt: now });
  }
  if (batch.length === BATCH_SIZE) {
    await ctx.runMutation(internal.execution.maintenance_bulk_queues.enqueueMemoryBulkApprove, { userId });
  }
  return batch.length;
}

export async function rejectAllHandler(ctx: MutationCtx): Promise<number> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  // Single batch per mutation with a Workpool continuation.
  const BATCH_SIZE = 100;
  const batch = await ctx.db
    .query("memories")
    .withIndex("by_user_pending", (q) => q.eq("userId", userId).eq("isPending", true))
    .take(BATCH_SIZE);
  for (const memory of batch) {
    await deleteMemoryWithDerivedData(ctx, memory._id, userId);
  }
  if (batch.length === BATCH_SIZE) {
    await ctx.runMutation(internal.execution.maintenance_bulk_queues.enqueueMemoryBulkReject, { userId });
  }
  return batch.length;
}
