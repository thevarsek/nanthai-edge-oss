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
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.union(v.null(), presentationStudioContextValidator),
  handler: async (ctx, args) => {
    const [run, batch] = await Promise.all([
      ctx.db.get(args.runId),
      ctx.db.get(args.batchId),
    ]);
    const suppliedFence = args.executionAttemptId !== undefined
      || args.executionFence !== undefined;
    if (!run || (suppliedFence && (
      run.executionAttemptId !== args.executionAttemptId
      || run.executionFence !== args.executionFence
    )) || !batch ||
        batch.runId !== run._id || batch.userId !== run.userId) return null;
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
  args: {
    runId: Id<"presentationGenerationRuns">;
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
  },
) {
  const context = await curatorContext(ctx, args.runId);
  if (!context) return null;
  const suppliedFence = args.executionAttemptId !== undefined
    || args.executionFence !== undefined;
  return !suppliedFence || (
    context.run.executionAttemptId === args.executionAttemptId
    && context.run.executionFence === args.executionFence
  ) ? context : null;
}

export const getPresentationCuratorContext = internalQuery({
  args: {
    runId: v.id("presentationGenerationRuns"),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.union(v.null(), presentationCuratorContextValidator),
  handler: getPresentationCuratorContextHandler,
});

export const getPresentationCuratorTaskContext = internalQuery({
  args: {
    taskId: v.id("presentationCuratorTasks"),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.union(v.null(), presentationCuratorTaskContextValidator),
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const context = await curatorContext(ctx, task.runId);
    if (!context) return null;
    const suppliedFence = args.executionAttemptId !== undefined
      || args.executionFence !== undefined;
    return !suppliedFence || (
      context.run.executionAttemptId === args.executionAttemptId
      && context.run.executionFence === args.executionFence
    ) ? { ...context, task } : null;
  },
});
