import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";
import {
  shouldExecuteScheduledJob,
  shouldReplaceExistingSchedule,
} from "./actions_execution_policy";
import { enqueueStep } from "./actions_execution";
import {
  handleFailure,
  scheduleFailureNotification,
  scheduleNextRunIfNeeded,
} from "./actions_lifecycle";
import { type Recurrence } from "./recurrence";
import { getScheduledJobSteps } from "./shared";

export async function executeScheduledJobHandler(
  ctx: ActionCtx,
  args: {
    jobId: Id<"scheduledJobs">;
    invocationSource?: "scheduled" | "manual" | "api";
    templateVariables?: Record<string, string>;
  },
): Promise<void> {
  const job = await ctx.runQuery(
    internal.scheduledJobs.queries.getJobInternal,
    { jobId: args.jobId },
  );
  if (!job) return;

  const invocationSource = args.invocationSource ?? "scheduled";
  if (!shouldExecuteScheduledJob({
    status: job.status,
    recurrence: job.recurrence as Recurrence,
    invocationSource,
  })) {
    return;
  }

  const steps = getScheduledJobSteps(job);
  const startedAt = Date.now();
  const executionId = `${args.jobId}:${startedAt}:${Math.random().toString(36).slice(2, 10)}`;

  try {
    const beginResult = await ctx.runMutation(
      internal.scheduledJobs.mutations.beginExecution,
      {
        jobId: args.jobId,
        executionId,
        startedAt,
        stepCount: steps.length,
        templateVariables: args.templateVariables,
      },
    );
    if (!beginResult.started) {
      if (invocationSource === "scheduled") {
        await scheduleNextRunIfNeeded(ctx, {
          jobId: args.jobId,
          recurrence: job.recurrence as Recurrence,
          timezone: job.timezone,
          status: job.status,
          scheduledFunctionId: job.scheduledFunctionId,
          replaceExistingSchedule: false,
        });
      }
      return;
    }

    await scheduleNextRunIfNeeded(ctx, {
      jobId: args.jobId,
      recurrence: job.recurrence as Recurrence,
      timezone: job.timezone,
      status: job.status,
      scheduledFunctionId: job.scheduledFunctionId,
      replaceExistingSchedule: shouldReplaceExistingSchedule({
        status: job.status,
        invocationSource,
      }),
    });

    const apiKey = await ctx.runQuery(
      internal.scheduledJobs.queries.getUserApiKey,
      { userId: job.userId },
    );
    if (!apiKey) {
      await handleFailure(
        ctx,
        args.jobId,
        job.consecutiveFailures ?? 0,
        "No API key found — reconnect OpenRouter in Settings",
        startedAt,
      );
      return;
    }

    const chatId = await ctx.runMutation(
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

    await enqueueStep(ctx, {
      jobId: args.jobId,
      chatId,
      userId: job.userId,
      executionId,
      step: steps[0],
      stepIndex: 0,
      templateVariables: args.templateVariables,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await handleFailure(ctx, args.jobId, job.consecutiveFailures ?? 0, errorMessage, startedAt);
    await scheduleFailureNotification(ctx, {
      userId: job.userId,
      jobName: job.name,
      errorMessage,
    });
  }
}

export async function continueScheduledJobExecutionHandler(
  ctx: ActionCtx,
  args: {
    jobId: Id<"scheduledJobs">;
    chatId: Id<"chats">;
    executionId: string;
    completedStepIndex: number;
    assistantMessageId: Id<"messages">;
  },
): Promise<void> {
  const job = await ctx.runQuery(
    internal.scheduledJobs.queries.getJobInternal,
    { jobId: args.jobId },
  );
  if (!job) return;
  if (job.activeExecutionId !== args.executionId) return;
  if (job.activeExecutionChatId !== args.chatId) return;
  if (job.activeStepIndex !== args.completedStepIndex) return;

  const steps = getScheduledJobSteps(job);
  const startedAt = job.activeExecutionStartedAt ?? Date.now();

  try {
    if (args.completedStepIndex >= steps.length - 1) {
      await ctx.runMutation(
        internal.scheduledJobs.mutations.recordRunSuccess,
        { jobId: args.jobId, chatId: args.chatId, startedAt },
      );
      await ctx.scheduler.runAfter(0, internal.push.actions.sendPushNotification, {
        userId: job.userId,
        title: `${job.name} — Complete`,
        body: "Your scheduled job finished successfully.",
        chatId: args.chatId as string,
      });
      return;
    }

    const apiKey = await ctx.runQuery(
      internal.scheduledJobs.queries.getUserApiKey,
      { userId: job.userId },
    );
    if (!apiKey) {
      throw new ConvexError({ code: "MISSING_API_KEY" as const, message: "No API key found — reconnect OpenRouter in Settings" });
    }

    const assistantMessage = await ctx.runQuery(
      internal.chat.queries.getMessageInternal,
      { messageId: args.assistantMessageId },
    );
    const previousAssistantContent = assistantMessage?.content ?? "";

    await enqueueStep(ctx, {
      jobId: args.jobId,
      chatId: args.chatId,
      userId: job.userId,
      executionId: args.executionId,
      step: steps[args.completedStepIndex + 1],
      stepIndex: args.completedStepIndex + 1,
      previousAssistantContent,
      templateVariables: job.activeExecutionVariables as Record<string, string> | undefined,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await handleFailure(ctx, args.jobId, job.consecutiveFailures ?? 0, errorMessage, startedAt);
    await scheduleFailureNotification(ctx, {
      userId: job.userId,
      jobName: job.name,
      errorMessage,
      chatId: args.chatId as string,
    });
  }
}

export async function failScheduledJobExecutionHandler(
  ctx: ActionCtx,
  args: {
    jobId: Id<"scheduledJobs">;
    executionId: string;
    error: string;
  },
): Promise<void> {
  const job = await ctx.runQuery(
    internal.scheduledJobs.queries.getJobInternal,
    { jobId: args.jobId },
  );
  if (!job) return;
  if (job.activeExecutionId !== args.executionId) return;

  await handleFailure(
    ctx,
    args.jobId,
    job.consecutiveFailures ?? 0,
    args.error,
    job.activeExecutionStartedAt ?? undefined,
  );

  await scheduleFailureNotification(ctx, {
    userId: job.userId,
    jobName: job.name,
    errorMessage: args.error,
    chatId: job.activeExecutionChatId as string | undefined,
  });
}
