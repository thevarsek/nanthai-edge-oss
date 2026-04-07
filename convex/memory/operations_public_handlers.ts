import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { requireAuth, requirePro } from "../lib/auth";
import {
  normalizeMemoryRecord,
  normalizeMemoryScopeType,
  type MemoryCategory,
  type MemoryRetrievalMode,
} from "./shared";

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

async function deleteMemoryWithEmbedding(
  ctx: MutationCtx,
  memoryId: Id<"memories">,
): Promise<void> {
  const embedding = await ctx.db
    .query("memoryEmbeddings")
    .withIndex("by_memory", (q) => q.eq("memoryId", memoryId))
    .first();
  if (embedding) {
    await ctx.db.delete(embedding._id);
  }
  await ctx.db.delete(memoryId);
}

async function refreshEmbedding(
  ctx: MutationCtx,
  memoryId: Id<"memories">,
  content: string,
): Promise<void> {
  const existing = await ctx.db
    .query("memoryEmbeddings")
    .withIndex("by_memory", (q) => q.eq("memoryId", memoryId))
    .first();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
  await ctx.scheduler.runAfter(0, internal.memory.operations.computeAndStoreEmbedding, {
    memoryId,
    content,
  });
}

export interface ListArgs extends Record<string, unknown> {
  limit?: number;
  pinnedOnly?: boolean;
}

export async function listHandler(
  ctx: QueryCtx,
  args: ListArgs,
): Promise<Array<any>> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  const limit = args.limit ?? 100;
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
  await deleteMemoryWithEmbedding(ctx, args.memoryId);
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
  await deleteMemoryWithEmbedding(ctx, args.memoryId);
}

export interface UpdateArgs extends Record<string, unknown> {
  memoryId: Id<"memories">;
  content?: string;
  category?: MemoryCategory;
  retrievalMode?: MemoryRetrievalMode;
  scopeType?: "allPersonas" | "selectedPersonas";
  personaIds?: string[];
  tags?: string[];
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

  await ctx.db.patch(args.memoryId, {
    content,
    category: args.category ?? memory.category,
    retrievalMode: args.retrievalMode ?? memory.retrievalMode,
    scopeType,
    personaIds,
    tags,
    updatedAt: Date.now(),
  });

  await refreshEmbedding(ctx, args.memoryId, content);
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

  await refreshEmbedding(ctx, memoryId, normalized.content);
  return memoryId;
}

export interface CommitImportedMemoriesArgs extends Record<string, unknown> {
  memories: Array<{
    content: string;
    category?: MemoryCategory;
    retrievalMode: MemoryRetrievalMode;
    scopeType: "allPersonas" | "selectedPersonas";
    personaIds?: string[];
    tags?: string[];
    isPinned?: boolean;
    sourceFileName?: string;
    importanceScore?: number;
    confidenceScore?: number;
  }>;
  isPending?: boolean;
}

export async function commitImportedMemoriesHandler(
  ctx: MutationCtx,
  args: CommitImportedMemoriesArgs,
): Promise<number> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  let created = 0;

  for (const item of args.memories) {
    const normalized = normalizeMemoryRecord({
      content: item.content.trim(),
      category: item.category,
      retrievalMode: item.retrievalMode,
      scopeType: item.scopeType,
      personaIds: item.personaIds,
      sourceType: "import",
      sourceFileName: item.sourceFileName,
      tags: item.tags,
    });
    if (!normalized.content) continue;

    const memoryId = await ctx.db.insert("memories", {
      userId,
      content: normalized.content,
      category: normalized.category,
      memoryType: normalized.category === "writingStyle" ? "responsePreference" : "profile",
      retrievalMode: normalized.retrievalMode,
      scopeType: normalized.scopeType,
      personaIds: normalized.personaIds,
      sourceType: "import",
      sourceFileName: normalized.sourceFileName,
      tags: normalized.tags,
      sourceMessageId: undefined,
      sourceChatId: undefined,
      isPinned: item.isPinned ?? false,
      isPending: args.isPending ?? false,
      accessCount: 0,
      importanceScore: item.importanceScore ?? 0.88,
      confidenceScore: item.confidenceScore ?? 0.82,
      reinforcementCount: 1,
      lastReinforcedAt: now,
      isSuperseded: false,
      createdAt: now,
      updatedAt: now,
    });
    created += 1;
    await refreshEmbedding(ctx, memoryId, normalized.content);
  }

  return created;
}

export async function deleteAllHandler(ctx: MutationCtx): Promise<void> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  // P2-12: Process a single batch per mutation. If more remain, schedule
  // a continuation to avoid blowing Convex transaction limits on large
  // memory collections.
  const BATCH_SIZE = 100;
  const batch = await ctx.db
    .query("memories")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .take(BATCH_SIZE);
  for (const memory of batch) {
    await deleteMemoryWithEmbedding(ctx, memory._id);
  }
  if (batch.length === BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.memory.operations_internal.deleteAllContinuation, { userId });
  }
}

export async function approveAllHandler(ctx: MutationCtx): Promise<number> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();
  // P2-12: Single batch per mutation with self-scheduling continuation.
  const BATCH_SIZE = 100;
  const batch = await ctx.db
    .query("memories")
    .withIndex("by_user_pending", (q) => q.eq("userId", userId).eq("isPending", true))
    .take(BATCH_SIZE);
  for (const memory of batch) {
    await ctx.db.patch(memory._id, { isPending: false, updatedAt: now });
  }
  if (batch.length === BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.memory.operations_internal.approveAllContinuation, { userId });
  }
  return batch.length;
}

export async function rejectAllHandler(ctx: MutationCtx): Promise<number> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  // P2-12: Single batch per mutation with self-scheduling continuation.
  const BATCH_SIZE = 100;
  const batch = await ctx.db
    .query("memories")
    .withIndex("by_user_pending", (q) => q.eq("userId", userId).eq("isPending", true))
    .take(BATCH_SIZE);
  for (const memory of batch) {
    await deleteMemoryWithEmbedding(ctx, memory._id);
  }
  if (batch.length === BATCH_SIZE) {
    await ctx.scheduler.runAfter(0, internal.memory.operations_internal.rejectAllContinuation, { userId });
  }
  return batch.length;
}
