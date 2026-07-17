import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import {
  presentationCuratorContextValidator,
  presentationCuratorTaskContextValidator,
  presentationStudioContextValidator,
} from "./generation_fanout_validators";

export const getPresentationStudioContext = internalQuery({
  args: {
    runId: v.id("presentationGenerationRuns"),
    batchId: v.id("presentationGenerationBatches"),
  },
  returns: v.union(v.null(), presentationStudioContextValidator),
  handler: async (ctx, args) => {
    const [run, batch] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.batchId),
    ]);
    if (!run || !batch || batch.runId !== run._id || batch.userId !== run.userId) return null;
    const project = await ctx.db.get(run.projectId);
    if (!project || project.userId !== run.userId) return null;
    return { run, batch, project };
  },
});

async function curatorContext(
  ctx: QueryCtx,
  runId: Id<"presentationGenerationRuns">,
) {
  const run = await ctx.db.get(runId);
  if (!run) return null;
  const [project, unsortedCandidates, tasks] = await Promise.all([
    ctx.db.get(run.projectId),
    ctx.db.query("presentationSlideCandidates")
      .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
    ctx.db.query("presentationCuratorTasks")
      .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
  ]);
  if (!project || project.userId !== run.userId) return null;
  const candidates = unsortedCandidates.sort((left, right) => left.position - right.position);
  return { run, project, candidates, tasks };
}

async function getPresentationCuratorContextHandler(
  ctx: QueryCtx,
  args: { runId: Id<"presentationGenerationRuns"> },
) {
  return await curatorContext(ctx, args.runId);
}

export const getPresentationCuratorContext = internalQuery({
  args: { runId: v.id("presentationGenerationRuns") },
  returns: v.union(v.null(), presentationCuratorContextValidator),
  handler: getPresentationCuratorContextHandler,
});

export const getPresentationCuratorTaskContext = internalQuery({
  args: { taskId: v.id("presentationCuratorTasks") },
  returns: v.union(v.null(), presentationCuratorTaskContextValidator),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const context = await curatorContext(ctx, task.runId);
    return context ? { ...context, task } : null;
  },
});
