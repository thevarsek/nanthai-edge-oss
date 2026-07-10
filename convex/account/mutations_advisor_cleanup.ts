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
    await cancelAll(ctx, [run.scheduledFunctionId, run.watchdogScheduledFunctionId]);
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
    await cancelAll(ctx, [
      ...(batch.scheduledFinalGenerationIds ?? []),
      batch.scheduledFinalGenerationId,
    ]);
    await ctx.db.delete(batch._id);
  }
  return batches.length;
}

async function cancelAll(
  ctx: MutationCtx,
  scheduledIds: Array<Parameters<MutationCtx["scheduler"]["cancel"]>[0] | undefined>,
): Promise<void> {
  for (const scheduledId of scheduledIds) {
    if (!scheduledId) continue;
    try {
      await ctx.scheduler.cancel(scheduledId);
    } catch {
      // Already executing or terminal.
    }
  }
}
