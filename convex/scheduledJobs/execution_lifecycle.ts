import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { DataModel, Doc, Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import {
  createAndClaimDomainExecution,
  heartbeatDomainExecution,
  linkDomainComponent,
  type DomainExecutionRef,
} from "../execution/domain_lifecycle";
import { interactiveWorkpool } from "../execution/components";
import { notifyScheduledStepTerminal } from "./workflow_signals";
import { terminalizeExecutionComponentByOperation } from "../execution/component_refs";
import { scheduleWorkpoolCompletionWatchdog } from
  "../execution/workpool_watchdog_schedule";
import { runWebSearchArgs, type WebSearchActionArgs } from
  "../search/actions_web_search_shared";

const scheduledStepWorkContext = v.object({
  jobId: v.id("scheduledJobs"),
  executionId: v.string(),
  stepIndex: v.number(),
  assistantMessageId: v.id("messages"),
});

export const reconcileScheduledStepWork = interactiveWorkpool.defineOnComplete<
  DataModel,
  typeof scheduledStepWorkContext
>({
  context: scheduledStepWorkContext,
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.context.assistantMessageId);
    const searchSession = await ctx.db.query("searchSessions")
      .withIndex("by_message", (query) =>
        query.eq("assistantMessageId", args.context.assistantMessageId),
      )
      .first();
    const handoffCommitted = Boolean(
      searchSession?.generationHandoffOperationId,
    );
    const outcome = message?.status === "completed" || handoffCommitted
      || args.result.kind === "success"
      ? "completed"
      : message?.status === "cancelled" || args.result.kind === "canceled"
        ? "cancelled"
        : "failed";
    await terminalizeExecutionComponentByOperation(
      ctx,
      "interactive-workpool",
      String(args.workId),
      outcome,
    );
    if (outcome === "completed" && message?.status !== "completed") return;
    if (outcome === "completed") {
      await notifyScheduledStepTerminal(ctx, {
        jobId: args.context.jobId as Id<"scheduledJobs">,
        executionId: args.context.executionId,
        stepIndex: args.context.stepIndex,
        assistantMessageId: args.context.assistantMessageId as Id<"messages">,
        status: "completed",
      });
      return;
    }
    await notifyScheduledStepTerminal(ctx, {
      jobId: args.context.jobId as Id<"scheduledJobs">,
      executionId: args.context.executionId,
      stepIndex: args.context.stepIndex,
      assistantMessageId: args.context.assistantMessageId as Id<"messages">,
      status: outcome === "cancelled" ? "cancelled" : "failed",
      error: outcome === "failed" && args.result.kind === "failed"
        ? args.result.error
        : outcome === "failed"
          ? "Scheduled generation failed without a terminal message."
          : "Scheduled generation was cancelled.",
    });
  },
});

export function scheduledExecutionRef(
  job: Doc<"scheduledJobs">,
): DomainExecutionRef | null {
  if (
    !job.executionRunId ||
    !job.executionAttemptId ||
    job.executionFence === undefined ||
    !job.executionClaimantId
  )
    return null;
  return {
    runId: job.executionRunId,
    attemptId: job.executionAttemptId,
    fence: job.executionFence,
    claimantId: job.executionClaimantId,
  };
}

export const initializeScheduledExecution = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    occurrenceId: v.string(),
    workflowId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.activeExecutionId !== args.executionId) {
      throw new Error("SCHEDULED_EXECUTION_NOT_ACTIVE");
    }
    if (job.activeWorkflowId === args.workflowId) {
      const existing = scheduledExecutionRef(job);
      if (existing) {
        await heartbeatDomainExecution(ctx, existing);
        return null;
      }
    }
    const claimantId = `scheduled-workflow:${args.workflowId}`;
    const execution = await createAndClaimDomainExecution(ctx, {
      userId: job.userId,
      runKey: `scheduled:${String(job._id)}:${args.occurrenceId}`,
      kind: "scheduled_job",
      domainType: "scheduled_job_occurrence",
      domainId: args.executionId,
      claimantId,
      chatId: job.activeExecutionChatId,
    });
    await linkDomainComponent(ctx, execution, {
      adapterId: "convex-workflow",
      operationId: args.workflowId,
      role: "scheduled-job-workflow",
    });
    await ctx.db.patch(job._id, {
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
      executionClaimantId: claimantId,
    });
    return null;
  },
});

export const heartbeatScheduledExecution = internalMutation({
  args: { jobId: v.id("scheduledJobs"), executionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.activeExecutionId !== args.executionId) {
      throw new Error("SCHEDULED_EXECUTION_STALE");
    }
    const execution = scheduledExecutionRef(job);
    if (execution) await heartbeatDomainExecution(ctx, execution);
    return null;
  },
});

export const linkScheduledWorkpool = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    operationId: v.string(),
    role: v.string(),
    stepIndex: v.number(),
    assistantMessageId: v.id("messages"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.activeExecutionId !== args.executionId) {
      throw new Error("SCHEDULED_EXECUTION_STALE");
    }
    const execution = scheduledExecutionRef(job);
    if (execution) {
      await linkDomainComponent(ctx, execution, {
        adapterId: "interactive-workpool",
        operationId: args.operationId,
        role: args.role,
      });
    }
    await scheduleWorkpoolCompletionWatchdog(ctx, {
      kind: "scheduled_step",
      operationId: args.operationId,
      jobId: args.jobId,
      executionId: args.executionId,
      stepIndex: args.stepIndex,
      assistantMessageId: args.assistantMessageId,
    });
    return null;
  },
});

export const enqueueScheduledWebSearch = internalMutation({
  args: {
    ...runWebSearchArgs,
    scheduledJobId: v.id("scheduledJobs"),
    executionId: v.string(),
    stepIndex: v.number(),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const { scheduledJobId, executionId, stepIndex, ...searchArgs } = args;
    const job = await ctx.db.get(scheduledJobId);
    if (!job || job.activeExecutionId !== executionId || job.activeStepIndex !== stepIndex) {
      throw new Error("SCHEDULED_EXECUTION_STALE");
    }
    const execution = scheduledExecutionRef(job);
    if (execution) {
      const existing = await ctx.db.query("executionComponentRefs")
        .withIndex("by_run_role", (q) => q
          .eq("runId", execution.runId)
          .eq("role", "scheduled-web-search"))
        .unique();
      if (existing && (existing.status === "active" || existing.status === "cancel_requested")) {
        return existing.operationId;
      }
    }
    const operationId = await interactiveWorkpool.enqueueAction(
      ctx,
      internal.search.actions.runWebSearch,
      searchArgs as WebSearchActionArgs,
      {
        retry: false,
        name: "scheduled-web-search",
        onComplete: internal.scheduledJobs.execution_lifecycle.reconcileScheduledStepWork,
        context: {
          jobId: scheduledJobId,
          executionId,
          stepIndex,
          assistantMessageId: args.assistantMessageId,
        },
      },
    );
    if (execution) {
      await linkDomainComponent(ctx, execution, {
        adapterId: "interactive-workpool",
        operationId,
        role: "scheduled-web-search",
      });
    }
    await scheduleWorkpoolCompletionWatchdog(ctx, {
      kind: "scheduled_step",
      operationId,
      jobId: scheduledJobId,
      executionId,
      stepIndex,
      assistantMessageId: args.assistantMessageId,
    });
    return operationId;
  },
});
