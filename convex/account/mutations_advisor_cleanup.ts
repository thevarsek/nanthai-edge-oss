import type { MutationCtx } from "../_generated/server";
import { deleteAdvisorRunAndReclaimAvatar } from "../advisors/avatar_storage";

export async function deleteUserAdvisorRunsBatch(
  ctx: MutationCtx,
  userId: string,
  batchSize: number,
): Promise<number> {
  const runs = await ctx.db
    .query("advisorRuns")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .take(batchSize);
  for (const run of runs) {
    await deleteAdvisorRunAndReclaimAvatar(ctx, run);
  }
  return runs.length;
}

export async function deleteUserAdvisorBatchesBatch(
  ctx: MutationCtx,
  userId: string,
  batchSize: number,
): Promise<number> {
  const batches = await ctx.db
    .query("advisorBatches")
    .withIndex("by_user", (query) => query.eq("userId", userId))
    .take(batchSize);
  for (const batch of batches) {
    await ctx.db.delete(batch._id);
  }
  return batches.length;
}
