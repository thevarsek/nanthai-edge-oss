"use node";

import { internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  TERMINAL_GENERATION_JOB_STATUSES,
} from "../chat/generation_continuation_shared";
import { snapshotResult } from "../tools/presentation_tools_node";
import { planProjectHandler } from "./action_plan_handler";
import { createPresentationActionDepsForTest } from "./action_shared";
import { getProjectInternalRef, setWorkflowPhaseRef } from "./action_refs";
import {
  PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
} from "./limits";
import { DeferredPresentationRepair } from "./deferred_repair";
import {
  type DeferredPresentationWorkflowArgs,
  runDeferredPresentationGenerateRepairRef,
  runDeferredPresentationGenerateRef,
  runDeferredPresentationPlanRepairRef,
} from "./deferred_workflow_refs";
import { completeAndResume, failAndResume } from "./deferred_workflow_resume";
import {
  deletePresentationRepairCandidate,
  storePresentationRepairCandidate,
} from "./repair_candidate_storage";
import { startPresentationFanoutRef } from "./generation_fanout_refs";

const workflowArgs = {
  projectId: v.id("presentationProjects"),
  userId: v.string(),
  jobId: v.id("generationJobs"),
  toolCallId: v.string(),
  modelId: v.string(),
  requireZdrOverride: v.optional(v.boolean()),
};

export function workflowDeps(userId: string) {
  return createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId }),
  });
}

export async function workflowIsActive(
  ctx: ActionCtx,
  jobId: Id<"generationJobs">,
): Promise<boolean> {
  const job = await ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
    jobId,
  });
  return Boolean(job && !TERMINAL_GENERATION_JOB_STATUSES.has(job.status));
}

export async function schedulePhase<Args extends DeferredPresentationWorkflowArgs>(
  ctx: ActionCtx,
  args: Args,
  ref: Parameters<ActionCtx["scheduler"]["runAfter"]>[1],
): Promise<boolean> {
  if (!(await workflowIsActive(ctx, args.jobId))) return false;
  const scheduledFunctionId = await ctx.scheduler.runAfter(0, ref, args);
  await ctx.runMutation(internal.chat.mutations.setGenerationContinuationScheduled, {
    jobId: args.jobId,
    scheduledFunctionId,
  });
  return true;
}

export const runDeferredPresentationPlan = internalAction({
  args: workflowArgs,
  handler: async (ctx, args): Promise<void> => {
    try {
      if (!(await workflowIsActive(ctx, args.jobId))) return;
      const project = await ctx.runQuery(getProjectInternalRef, {
        projectId: args.projectId,
        userId: args.userId,
      });
      if (!project) throw new Error("Presentation not found or unauthorized.");
      if (project.status === "draft") {
        await planProjectHandler(ctx, {
          projectId: project._id,
          prompt: project.prompt,
          direction: project.direction,
          imageMode: project.imageMode,
          modelId: args.modelId,
          requireZdrOverride: args.requireZdrOverride,
        }, workflowDeps(args.userId), {
          deferRepair: true,
          modelTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
        });
      } else if (project.status === "failed") {
        throw new Error(project.error ?? "Presentation planning failed.");
      }
      await schedulePhase(ctx, args, runDeferredPresentationGenerateRef);
    } catch (error) {
      if (error instanceof DeferredPresentationRepair) {
        const project = await ctx.runQuery(getProjectInternalRef, {
          projectId: args.projectId,
          userId: args.userId,
        });
        if (project) {
          await ctx.runMutation(setWorkflowPhaseRef, {
            projectId: project._id,
            userId: args.userId,
            expectedRevision: project.revision,
            phase: "repairing_plan",
          });
        }
        await schedulePhase(ctx, {
          ...args,
          invalidResponse: error.invalidResponse.slice(0, 20_000),
          validationError: error.validationError.slice(0, 500),
          ...(error.effectiveModelId
            ? { priorEffectiveModelId: error.effectiveModelId }
            : {}),
        }, runDeferredPresentationPlanRepairRef);
        return;
      }
      await failAndResume(ctx, args, error);
    }
  },
});

export const runDeferredPresentationGenerate = internalAction({
  args: workflowArgs,
  handler: async (ctx, args): Promise<void> => {
    try {
      if (!(await workflowIsActive(ctx, args.jobId))) return;
      const project = await ctx.runQuery(getProjectInternalRef, {
        projectId: args.projectId,
        userId: args.userId,
      });
      if (!project) throw new Error("Presentation not found or unauthorized.");
      if (project.status === "planned") {
        await ctx.runMutation(startPresentationFanoutRef, {
          projectId: project._id,
          userId: args.userId,
          jobId: args.jobId,
          toolCallId: args.toolCallId,
          expectedRevision: project.revision,
          modelId: args.modelId,
          ...(args.requireZdrOverride !== undefined
            ? { requireZdrOverride: args.requireZdrOverride }
            : {}),
        });
      } else if (project.status === "failed") {
        throw new Error(project.error ?? "Presentation generation failed.");
      }
    } catch (error) {
      if (error instanceof DeferredPresentationRepair) {
        const project = await ctx.runQuery(getProjectInternalRef, {
          projectId: args.projectId,
          userId: args.userId,
        });
        if (project) {
          await ctx.runMutation(setWorkflowPhaseRef, {
            projectId: project._id,
            userId: args.userId,
            expectedRevision: project.revision,
            phase: "repairing_generation",
          });
        }
        let candidateStorageId: Id<"_storage"> | undefined;
        if (error.targetSlideId) {
          candidateStorageId = await storePresentationRepairCandidate(
            ctx,
            error.invalidResponse,
          );
        }
        try {
          const scheduled = await schedulePhase(ctx, {
            ...args,
            invalidResponse: error.invalidResponse.slice(0, 20_000),
            validationError: error.validationError.slice(0, 500),
            ...(candidateStorageId && error.targetSlideId
              ? { candidateStorageId, targetSlideId: error.targetSlideId }
              : {}),
            ...(error.effectiveModelId
              ? { priorEffectiveModelId: error.effectiveModelId }
              : {}),
            repairAttempt: 1,
          }, runDeferredPresentationGenerateRepairRef);
          if (!scheduled && candidateStorageId) {
            await deletePresentationRepairCandidate(ctx, candidateStorageId);
          }
        } catch (scheduleError) {
          await deletePresentationRepairCandidate(ctx, candidateStorageId);
          throw scheduleError;
        }
        return;
      }
      await failAndResume(ctx, args, error);
    }
  },
});

export const runDeferredPresentationSnapshot = internalAction({
  args: workflowArgs,
  handler: async (ctx, args): Promise<void> => {
    try {
      if (!(await workflowIsActive(ctx, args.jobId))) return;
      const project = await ctx.runQuery(getProjectInternalRef, {
        projectId: args.projectId,
        userId: args.userId,
      });
      if (!project || project.status !== "ready") {
        throw new Error(project?.error ?? "Presentation slides were not ready for export.");
      }
      const result = await snapshotResult(
        { ctx, userId: args.userId, jobId: args.jobId },
        project._id,
        project.revision,
        "create_presentation",
      );
      await completeAndResume(ctx, args, result);
    } catch (error) {
      await failAndResume(ctx, args, error);
    }
  },
});

export const expireDeferredPresentation = internalAction({
  args: workflowArgs,
  handler: async (ctx, args): Promise<void> => {
    if (!(await workflowIsActive(ctx, args.jobId))) return;
    await failAndResume(
      ctx,
      args,
      new Error("Presentation generation timed out between durable phases. Try again."),
    );
  },
});
