import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function deleteMemoryRelationships(
  ctx: MutationCtx,
  memoryId: Id<"memories">,
  userId: string,
): Promise<void> {
  const [outgoing, incoming] = await Promise.all([
    ctx.db.query("memoryRelationships")
      .withIndex("by_user_from", (query) =>
        query.eq("userId", userId).eq("fromMemoryId", memoryId)
      ).collect(),
    ctx.db.query("memoryRelationships")
      .withIndex("by_user_to", (query) =>
        query.eq("userId", userId).eq("toMemoryId", memoryId)
      ).collect(),
  ]);
  const relationshipIds = new Set([...outgoing, ...incoming].map((row) => row._id));
  for (const relationshipId of relationshipIds) await ctx.db.delete(relationshipId);
}

export async function deleteMemoryWithDerivedData(
  ctx: MutationCtx,
  memoryId: Id<"memories">,
  knownUserId?: string,
): Promise<void> {
  const memory = await ctx.db.get(memoryId);
  const userId = knownUserId ?? memory?.userId;
  if (!userId) return;
  // Remove reciprocal history references without reactivating obsolete facts.
  for (const [linkedId, field] of [
    [memory?.supersedesMemoryId, "supersededByMemoryId"],
    [memory?.supersededByMemoryId, "supersedesMemoryId"],
  ] as const) {
    if (!linkedId) continue;
    const linked = await ctx.db.get(linkedId);
    if (linked?.userId === userId && linked[field] === memoryId) {
      await ctx.db.patch(linked._id, { [field]: undefined });
    }
  }
  await deleteMemoryRelationships(ctx, memoryId, userId);
  const embedding = await ctx.db
    .query("memoryEmbeddings")
    .withIndex("by_memory", (query) => query.eq("memoryId", memoryId))
    .first();
  if (embedding) await ctx.db.delete(embedding._id);
  await ctx.db.delete(memoryId);
}
