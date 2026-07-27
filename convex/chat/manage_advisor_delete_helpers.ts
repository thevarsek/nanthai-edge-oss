import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteAdvisorRunAndReclaimAvatar } from "../advisors/avatar_storage";

/** Delete one bounded pass of Advisor-owned chat data and cancel delayed work. */
export async function deleteChatAdvisorDataBatch(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  batchSize: number,
): Promise<boolean> {
  const batches = await ctx.db
    .query("advisorBatches")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(batchSize);
  for (const batch of batches) {
    const runs = await ctx.db
      .query("advisorRuns")
      .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
      .collect();
    for (const run of runs) {
      await deleteAdvisorRunAndReclaimAvatar(ctx, run);
    }
    await ctx.db.delete(batch._id);
  }

  const assignments = await ctx.db
    .query("chatAdvisors")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(batchSize);
  for (const assignment of assignments) {
    await ctx.db.delete(assignment._id);
  }

  return batches.length === batchSize || assignments.length === batchSize;
}
