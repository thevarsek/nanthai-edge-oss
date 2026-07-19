"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { snapshotResult } from "../tools/presentation_tools_node";
import { planProjectHandler } from "./action_plan_handler";
import { createPresentationActionDepsForTest } from "./action_shared";
import { getProjectInternalRef } from "./action_refs";
import { completeAndResume, failAndResume } from "./deferred_workflow_resume";
import { workflowArgsValidator } from "./presentation_workflow_validators";
import { safePresentationErrorMessage } from "./limits";

export const runPresentationPlanStep = internalAction({
  args: workflowArgsValidator,
  returns: v.object({ projectRevision: v.number() }),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.execution.mutations.validateFence, {
      attemptId: args.executionAttemptId,
      fence: args.executionFence,
    });
    const project = await ctx.runQuery(getProjectInternalRef, {
      projectId: args.projectId,
      userId: args.userId,
    });
    if (!project) throw new Error("Presentation not found or unauthorized.");
    if (
      project.executionAttemptId !== args.executionAttemptId
      || project.executionFence !== args.executionFence
    ) throw new Error("Presentation Workflow belongs to a superseded execution.");
    if (project.status === "planned" || project.status === "generating" || project.status === "ready") {
      return { projectRevision: project.revision };
    }
    if (project.status === "failed") {
      throw new Error(project.error ?? "Presentation planning failed.");
    }
    const result = await planProjectHandler(ctx, {
      projectId: project._id,
      prompt: project.prompt,
      direction: project.direction,
      imageMode: project.imageMode,
      modelId: args.modelId,
      ...(args.requireZdrOverride !== undefined
        ? { requireZdrOverride: args.requireZdrOverride }
        : {}),
    }, createPresentationActionDepsForTest({
      requireAuth: async () => ({ userId: args.userId }),
    }), { workflowManaged: true });
    return { projectRevision: result.projectRevision };
  },
});

export const runPresentationSnapshotStep = internalAction({
  args: { ...workflowArgsValidator, expectedRevision: v.number() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.execution.mutations.validateFence, {
      attemptId: args.executionAttemptId,
      fence: args.executionFence,
    });
    const project = await ctx.runQuery(getProjectInternalRef, {
      projectId: args.projectId,
      userId: args.userId,
    });
    if (!project || project.status !== "ready") {
      throw new Error(project?.error ?? "Presentation slides were not ready for export.");
    }
    if (project.revision !== args.expectedRevision) {
      throw new Error("Presentation changed before its generation snapshot could be persisted.");
    }
    return await snapshotResult(
      { ctx, userId: args.userId, jobId: args.jobId },
      project._id,
      args.expectedRevision,
      "create_presentation",
    );
  },
});

export const completePresentationParentStep = internalAction({
  args: { ...workflowArgsValidator, result: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.execution.mutations.validateFence, {
      attemptId: args.executionAttemptId,
      fence: args.executionFence,
    });
    const { result, ...workflowArgs } = args;
    await completeAndResume(ctx, workflowArgs, result);
    const project = await ctx.runQuery(getProjectInternalRef, {
      projectId: args.projectId,
      userId: args.userId,
    });
    if (project?.executionAttemptId && project.executionFence !== undefined) {
      await ctx.runMutation(internal.execution.mutations.terminalize, {
        attemptId: project.executionAttemptId,
        fence: project.executionFence,
        outcome: result.success ? "completed" : "failed",
        summary: result.success
          ? "Presentation workflow completed"
          : result.error ?? "Presentation snapshot failed",
      });
    }
    return null;
  },
});

export const failPresentationWorkflowStep = internalAction({
  args: {
    ...workflowArgsValidator,
    error: v.string(),
    runId: v.optional(v.id("presentationGenerationRuns")),
    cancelled: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.execution.mutations.validateFence, {
      attemptId: args.executionAttemptId,
      fence: args.executionFence,
    });
    if (args.runId) {
      await ctx.runMutation(internal.presentations.generation_fanout_mutations.failPresentationFanout, {
        runId: args.runId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
        error: args.error,
      });
    }
    await failAndResume(ctx, args, new Error(safePresentationErrorMessage(args.error)));
    const project = await ctx.runQuery(getProjectInternalRef, {
      projectId: args.projectId,
      userId: args.userId,
    });
    if (project?.executionAttemptId && project.executionFence !== undefined) {
      await ctx.runMutation(internal.execution.mutations.terminalize, {
        attemptId: project.executionAttemptId,
        fence: project.executionFence,
        outcome: args.cancelled ? "cancelled" : "failed",
        summary: args.error,
      });
    }
    return null;
  },
});
