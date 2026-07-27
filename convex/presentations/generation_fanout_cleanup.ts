import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { WorkId } from "@convex-dev/workpool";
import { interactiveWorkpool } from "../execution/components";

export async function failPresentationRunState(
  ctx: MutationCtx,
  run: Doc<"presentationGenerationRuns">,
  error: string,
  now: number,
): Promise<void> {
  await ctx.db.patch(run._id, {
    status: "failed",
    error: error.slice(0, 500),
    completedAt: now,
    updatedAt: now,
  });
  const [batches, candidates, tasks] = await Promise.all([
    ctx.db.query("presentationGenerationBatches")
      .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
    ctx.db.query("presentationSlideCandidates")
      .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
    ctx.db.query("presentationCuratorTasks")
      .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
  ]);
  const operationIds = [
    run.curatorWorkpoolOperationId,
    run.finalizerWorkpoolOperationId,
    ...batches.map((batch) => batch.workpoolOperationId),
    ...tasks.map((task) => task.workpoolOperationId),
  ].filter((value): value is string => value !== undefined);
  await Promise.all(operationIds.map(async (operationId) => {
    await interactiveWorkpool.cancel(ctx, operationId as WorkId).catch(() => undefined);
  }));
  for (const batch of batches) {
    if (batch.status !== "complete") {
      await ctx.db.patch(batch._id, {
        status: "failed",
        completedAt: now,
        updatedAt: now,
      });
    }
  }
  await Promise.all(candidates.map((candidate) => ctx.db.delete(candidate._id)));
  await Promise.all(tasks.filter((task) => task.status !== "complete").map((task) =>
    ctx.db.patch(task._id, {
      status: "complete",
      error: "Presentation generation stopped before curation completed.",
      completedAt: now,
      updatedAt: now,
    })
  ));
}
