import { v } from "convex/values";
import { internal } from "../_generated/api";
import { getOptionalUserOpenRouterApiKey } from "../lib/user_secrets";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { enqueueStep } from "./actions_execution";
import {
  scheduleFailureNotification,
} from "./actions_lifecycle";
import {
  shouldExecuteScheduledJob,
} from "./actions_execution_policy";
import type { Recurrence } from "./recurrence";
import { getScheduledJobSteps } from "./shared";

const sourceValidator = v.optional(
  v.union(v.literal("scheduled"), v.literal("manual"), v.literal("api")),
);

export const initializeScheduledExecution = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    invocationSource: sourceValidator,
    templateVariables: v.optional(v.record(v.string(), v.string())),
    occurrenceId: v.string(),
    workflowId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      executionId: v.string(),
      chatId: v.id("chats"),
      stepCount: v.number(),
    }),
  ),
  handler: async (
    ctx,
    args,
  ): Promise<{
    executionId: string;
    chatId: Id<"chats">;
    stepCount: number;
  } | null> => {
    const job: Doc<"scheduledJobs"> | null = await ctx.runQuery(
      internal.scheduledJobs.queries.getJobInternal,
      {
        jobId: args.jobId,
      },
    );
    if (!job) return null;
    const invocationSource = args.invocationSource ?? "scheduled";
    const executionId = `${String(args.jobId)}:${args.occurrenceId}`;
    if (
      !shouldExecuteScheduledJob({
        status: job.status,
        recurrence: job.recurrence as Recurrence,
        invocationSource,
        isDeleting: job.isDeleting,
      })
    ) {
      await ctx.runMutation(
        internal.scheduledJobs.execution_terminal_commit.abandonScheduledExecution,
        {
          jobId: args.jobId,
          executionId,
          summary: `Scheduled occurrence stopped because job is ${job.status}`,
        },
      );
      return null;
    }

    const steps = getScheduledJobSteps(job);
    const startedAt = Date.now();
    const begin = await ctx.runMutation(
      internal.scheduledJobs.mutations.beginExecution,
      {
        jobId: args.jobId,
        executionId,
        workflowId: args.workflowId,
        occurrenceId: args.occurrenceId,
        startedAt,
        stepCount: steps.length,
        templateVariables: args.templateVariables,
      },
    );
    if (!begin.started) return null;
    await ctx.runMutation(
      internal.scheduledJobs.execution_lifecycle.initializeScheduledExecution,
      {
        jobId: args.jobId,
        executionId,
        occurrenceId: args.occurrenceId,
        workflowId: args.workflowId,
      },
    );

    await ctx.runMutation(internal.scheduledJobs.workflow_schedule.ensureNextOccurrence, {
      jobId: args.jobId,
      occurrenceId: args.occurrenceId,
      invocationSource,
    });
    const apiKey = await getOptionalUserOpenRouterApiKey(ctx, job.userId);
    if (!apiKey) {
      await ctx.runMutation(
        internal.scheduledJobs.execution_terminal_commit
          .commitScheduledExecutionFailure,
        {
          jobId: args.jobId,
          executionId,
          error: "No API key found — reconnect OpenRouter in Settings",
        },
      );
      return null;
    }
    const chatId: Id<"chats"> = await ctx.runMutation(
      internal.scheduledJobs.mutations.createJobChat,
      {
        jobId: args.jobId,
        userId: job.userId,
        jobName: job.name,
        targetFolderId: job.targetFolderId,
        sourceJobId: args.jobId,
        executionId,
      },
    );
    return { executionId, chatId, stepCount: steps.length };
  },
});

export const dispatchScheduledStep = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    chatId: v.id("chats"),
    stepIndex: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(
      internal.scheduledJobs.queries.getJobInternal,
      {
        jobId: args.jobId,
      },
    );
    if (!job || job.activeExecutionId !== args.executionId) return null;
    await ctx.runMutation(
      internal.scheduledJobs.execution_lifecycle.heartbeatScheduledExecution,
      { jobId: args.jobId, executionId: args.executionId },
    );
    const steps = getScheduledJobSteps(job);
    const step = steps[args.stepIndex];
    if (!step)
      throw new Error(`Scheduled step ${args.stepIndex} is unavailable`);
    const previousMessage = job.activeAssistantMessageId
      ? await ctx.runQuery(internal.chat.queries.getMessageInternal, {
          messageId: job.activeAssistantMessageId,
        })
      : null;
    await enqueueStep(ctx, {
      jobId: args.jobId,
      chatId: args.chatId,
      userId: job.userId,
      executionId: args.executionId,
      step,
      stepIndex: args.stepIndex,
      previousAssistantContent: previousMessage?.content,
      templateVariables: job.activeExecutionVariables as
        | Record<string, string>
        | undefined,
    });
    return null;
  },
});

export const completeScheduledExecution = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    chatId: v.id("chats"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(
      internal.scheduledJobs.queries.getJobInternal,
      {
        jobId: args.jobId,
      },
    );
    if (!job || job.activeExecutionId !== args.executionId) return null;
    await ctx.runMutation(
      internal.scheduledJobs.execution_lifecycle.heartbeatScheduledExecution,
      { jobId: args.jobId, executionId: args.executionId },
    );
    const recorded = await ctx.runMutation(
      internal.scheduledJobs.execution_terminal_commit
        .commitScheduledExecutionSuccess,
      {
        jobId: args.jobId,
        executionId: args.executionId,
        chatId: args.chatId,
      },
    );
    if (!recorded) return null;
    await ctx.scheduler.runAfter(
      0,
      internal.push.actions.sendPushNotification,
      {
        userId: job.userId,
        title: `${job.name} — Complete`,
        body: "Your scheduled job finished successfully.",
        chatId: String(args.chatId),
      },
    );
    return null;
  },
});

export const failScheduledExecution = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(
      internal.scheduledJobs.queries.getJobInternal,
      {
        jobId: args.jobId,
      },
    );
    if (!job || job.activeExecutionId !== args.executionId) return null;
    await ctx.runMutation(
      internal.scheduledJobs.execution_lifecycle.heartbeatScheduledExecution,
      { jobId: args.jobId, executionId: args.executionId },
    );
    const recorded = await ctx.runMutation(
      internal.scheduledJobs.execution_terminal_commit
        .commitScheduledExecutionFailure,
      args,
    );
    if (!recorded) return null;
    await scheduleFailureNotification(ctx, {
      userId: job.userId,
      jobName: job.name,
      errorMessage: args.error,
      chatId: job.activeExecutionChatId as string | undefined,
    });
    return null;
  },
});
