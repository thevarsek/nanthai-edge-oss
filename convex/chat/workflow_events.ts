import { vEventId, vResultValidator, type EventId, type WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { cleanupDurableWorkflow } from "../execution/workflow_cleanup";
import { saveGenerationContinuationArgs } from "./mutations_args";
import {
  completeDeferredToolHandler,
  generationResumeEventValue,
  installDeferredCheckpointAndSignalHandler,
  isIgnorableResumeSignalError,
} from "./workflow_resume_handlers";
import { startGenerationSuccessorHandler } from "./workflow_successor";
import { reconcileGenerationWorkflowCompletionHandler } from "./workflow_completion";
import { findActiveGenerationDriver } from "./generation_driver_components";
import { reconcileGenerationWorkflowWatchdogHandler } from "./generation_workflow_watchdog";
import { scheduleGenerationWorkflowWatchdog } from "./generation_workflow_watchdog_schedule";
import {
  generationParticipantWorkflowArgs,
  generationWorkflowChainState,
  type GenerationParticipantWorkflowArgs,
} from "./workflow_contract";

export { generationResumeEventValue } from "./workflow_resume_handlers";
export type { GenerationResumeEventValue } from "./workflow_resume_handlers";
export { startGenerationSuccessorHandler } from "./workflow_successor";
export * from "./workflow_contract";

const generationWorkflowCompletionRef = makeFunctionReference<"mutation">(
  "chat/workflow_events:reconcileGenerationWorkflowCompletion",
);

const TERMINAL_GENERATION_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

export const startGenerationWorkflow = internalMutation({
  args: generationParticipantWorkflowArgs,
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const job = await ctx.db.get(args.participant.jobId);
    if (
      !job
      || TERMINAL_GENERATION_STATUSES.has(job.status)
      || !job.executionRunId
      || !job.executionAttemptId
      || job.executionFence === undefined
    ) return null;
    if (
      args.executionAttemptId !== job.executionAttemptId
      || args.executionFence !== job.executionFence
    ) return null;
    const existing = await findActiveGenerationDriver(
      ctx,
      job.executionRunId as Id<"executionRuns">,
    );
    if (existing) return existing.operationId;
    const workflowArgs: GenerationParticipantWorkflowArgs = {
      ...args,
      journalProtocolVersion: 1,
    };
    const workflowId = String(await durableWorkflow.start(
      ctx,
      internal.chat.generation_workflow.runGenerationParticipantWorkflow,
      workflowArgs,
      {
        startAsync: true,
        onComplete: generationWorkflowCompletionRef,
        context: { participantArgs: workflowArgs },
      },
    ));
    const now = Date.now();
    await ctx.db.insert("executionComponentRefs", {
      runId: job.executionRunId,
      attemptId: job.executionAttemptId,
      userId: job.userId,
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "generation-workflow-primary",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await scheduleGenerationWorkflowWatchdog(ctx, {
      workflowId,
      participantArgs: workflowArgs,
    });
    return workflowId;
  },
});

export const reconcileGenerationWorkflowCompletion = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: v.object({ participantArgs: v.object(generationParticipantWorkflowArgs) }),
  },
  returns: v.null(),
  handler: reconcileGenerationWorkflowCompletionHandler,
});

export const reconcileGenerationWorkflowWatchdog = internalMutation({
  args: {
    workflowId: v.string(),
    participantArgs: v.object(generationParticipantWorkflowArgs),
  },
  returns: v.union(
    v.literal("missing"),
    v.literal("rescheduled"),
    v.literal("reconciled"),
    v.literal("settled"),
  ),
  handler: reconcileGenerationWorkflowWatchdogHandler,
});

export const cleanupGenerationWorkflow = internalMutation({
  args: { workflowId: v.string(), attempt: v.optional(v.number()) },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const attempt = args.attempt ?? 0;
    return await cleanupDurableWorkflow(ctx, args.workflowId, async () => {
      if (attempt < 12) {
        await ctx.scheduler.runAfter(
          5 * 60 * 1_000,
          internal.chat.workflow_events.cleanupGenerationWorkflow,
          { workflowId: args.workflowId, attempt: attempt + 1 },
        );
      }
    });
  },
});

export const createGenerationResume = internalMutation({
  args: {
    workflowId: v.string(),
    name: v.string(),
  },
  returns: vEventId(),
  handler: async (ctx, args): Promise<EventId<string>> => await durableWorkflow.createEvent(ctx, {
    workflowId: args.workflowId as WorkflowId,
    name: args.name,
  }),
});

export const signalGenerationResume = internalMutation({
  args: {
    eventId: v.string(),
    value: generationResumeEventValue,
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    try {
      await durableWorkflow.sendEvent(ctx, {
        id: args.eventId as EventId<string>,
        validator: generationResumeEventValue,
        value: args.value,
      });
      return true;
    } catch (error) {
      if (isIgnorableResumeSignalError(error)) return false;
      throw error;
    }
  },
});

export const startGenerationSuccessor = internalMutation({
  args: {
    ...generationParticipantWorkflowArgs,
    predecessorWorkflowId: v.string(),
    durableChain: generationWorkflowChainState,
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> =>
    await startGenerationSuccessorHandler(ctx, args),
});

export const completeDeferredTool = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    userId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    result: v.string(),
    isError: v.optional(v.boolean()),
    eventId: v.string(),
  },
  returns: v.union(
    v.literal("resumed"),
    v.literal("duplicate"),
    v.literal("missing"),
    v.literal("terminal"),
  ),
  handler: completeDeferredToolHandler,
});

export const installDeferredCheckpointAndSignal = internalMutation({
  args: {
    ...saveGenerationContinuationArgs,
    eventId: v.string(),
    resumeBatchId: v.optional(v.id("subagentBatches")),
  },
  returns: v.union(v.literal("resumed"), v.literal("duplicate"), v.literal("missing")),
  handler: installDeferredCheckpointAndSignalHandler,
});
