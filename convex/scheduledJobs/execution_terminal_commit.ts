import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { terminalizeDomainExecution } from "../execution/domain_lifecycle";
import {
  scheduledExecutionRef,
} from "./execution_lifecycle";
import { abortScheduledChildHandler } from "./scheduled_child_abort";
import { MAX_CONSECUTIVE_FAILURES } from "./actions_lifecycle";

const clearedExecutionFields = {
  activeExecutionId: undefined,
  activeOccurrenceId: undefined,
  activeWorkflowId: undefined,
  activeExecutionChatId: undefined,
  activeExecutionStartedAt: undefined,
  activeExecutionVariables: undefined,
  activeStepIndex: undefined,
  activeStepCount: undefined,
  activeUserMessageId: undefined,
  activeAssistantMessageId: undefined,
  activeGenerationJobId: undefined,
};

async function clearInvalidSuccess(
  ctx: MutationCtx,
  jobId: Id<"scheduledJobs">,
  executionId: string,
): Promise<void> {
  const job = await ctx.db.get(jobId);
  if (!job || job.activeExecutionId !== executionId) return;
  const execution = scheduledExecutionRef(job);
  if (execution) {
    await terminalizeDomainExecution(
      ctx,
      execution,
      "cancelled",
      "Scheduled completion was fenced by deletion or supersession",
    );
  }
  await ctx.db.patch(jobId, { ...clearedExecutionFields, updatedAt: Date.now() });
}

export const commitScheduledExecutionSuccess = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    chatId: v.id("chats"),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (!job || job.activeExecutionId !== args.executionId) return false;
    const [chat, tombstone] = await Promise.all([
      ctx.db.get(args.chatId),
      ctx.db.query("accountDeletionTombstones")
        .withIndex("by_user", (query) => query.eq("userId", job.userId))
        .unique(),
    ]);
    if (!chat || chat.userId !== job.userId || chat.isDeleting === true || tombstone) {
      await clearInvalidSuccess(ctx, args.jobId, args.executionId);
      return false;
    }
    const startedAt = job.activeExecutionStartedAt ?? now;
    await ctx.db.insert("jobRuns", {
      jobId: args.jobId,
      userId: job.userId,
      chatId: args.chatId,
      status: "success",
      startedAt,
      completedAt: now,
      durationMs: now - startedAt,
    });
    const execution = scheduledExecutionRef(job);
    if (execution) {
      await terminalizeDomainExecution(
        ctx,
        execution,
        "completed",
        "Scheduled job occurrence completed",
      );
    }
    await ctx.db.patch(args.jobId, {
      lastRunAt: now,
      lastRunChatId: args.chatId,
      lastRunStatus: "success",
      lastRunError: undefined,
      consecutiveFailures: 0,
      totalRuns: (job.totalRuns ?? 0) + 1,
      ...clearedExecutionFields,
      updatedAt: now,
    });
    return true;
  },
});

export const commitScheduledExecutionFailure = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    error: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const now = Date.now();
    const job = await ctx.db.get(args.jobId);
    if (!job || job.activeExecutionId !== args.executionId) return false;
    await abortScheduledChildHandler(ctx, args);
    const execution = scheduledExecutionRef(job);
    if (execution) {
      await terminalizeDomainExecution(ctx, execution, "failed", args.error);
    }
    const startedAt = job.activeExecutionStartedAt ?? now;
    const consecutiveFailures = (job.consecutiveFailures ?? 0) + 1;
    const autoPause = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
    await ctx.db.insert("jobRuns", {
      jobId: args.jobId,
      userId: job.userId,
      chatId: job.activeExecutionChatId,
      status: "failed",
      error: args.error,
      startedAt,
      completedAt: now,
      durationMs: now - startedAt,
    });
    if (autoPause && job.scheduledFunctionId) {
      try {
        await ctx.scheduler.cancel(job.scheduledFunctionId);
      } catch {
        // The scheduled function already ran or was cancelled.
      }
    }
    await ctx.db.patch(args.jobId, {
      lastRunAt: now,
      lastRunChatId: job.activeExecutionChatId,
      lastRunStatus: "failed",
      lastRunError: args.error,
      consecutiveFailures,
      status: autoPause ? "error" : job.status,
      totalRuns: (job.totalRuns ?? 0) + 1,
      nextRunAt: autoPause ? undefined : job.nextRunAt,
      scheduledFunctionId: autoPause ? undefined : job.scheduledFunctionId,
      nextScheduledOccurrenceId: autoPause
        ? undefined
        : job.nextScheduledOccurrenceId,
      ...clearedExecutionFields,
      updatedAt: now,
    });
    return true;
  },
});

export const abandonScheduledExecution = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    summary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.activeExecutionId !== args.executionId) return null;
    const execution = scheduledExecutionRef(job);
    if (execution) {
      await terminalizeDomainExecution(ctx, execution, "cancelled", args.summary);
    }
    await ctx.db.patch(job._id, {
      ...clearedExecutionFields,
      updatedAt: Date.now(),
    });
    return null;
  },
});
