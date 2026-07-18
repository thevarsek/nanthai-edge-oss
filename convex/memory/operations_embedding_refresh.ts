import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteMemoryRelationships } from "./cleanup";

export async function refreshMemoryEmbedding(
  ctx: MutationCtx,
  memoryId: Id<"memories">,
  userId: string,
  content: string,
): Promise<void> {
  const existing = await ctx.db
    .query("memoryEmbeddings")
    .withIndex("by_memory", (query) => query.eq("memoryId", memoryId))
    .first();
  if (existing) await ctx.db.delete(existing._id);
  await deleteMemoryRelationships(ctx, memoryId, userId);
  await ctx.scheduler.runAfter(0, internal.memory.operations.computeAndStoreEmbedding, {
    memoryId,
    content,
  });
}
