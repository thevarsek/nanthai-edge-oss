import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";
import { computeNextRunTime, type Recurrence } from "./recurrence";

export const MAX_CONSECUTIVE_FAILURES = 3;

export async function handleFailure(
  ctx: ActionCtx,
  jobId: Id<"scheduledJobs">,
  currentFailures: number,
  error: string,
  startedAt?: number,
): Promise<void> {
  const failures = currentFailures + 1;
  const autoPause = failures >= MAX_CONSECUTIVE_FAILURES;
  await ctx.runMutation(
    internal.scheduledJobs.mutations.recordRunFailure,
    {
      jobId,
      error,
      consecutiveFailures: failures,
      autoPause,
      startedAt,
    },
  );
}

export async function scheduleFailureNotification(
  ctx: ActionCtx,
  args: {
    userId: string;
    jobName: string;
    errorMessage: string;
    chatId?: string;
  },
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.push.actions.sendPushNotification, {
    userId: args.userId,
    title: `${args.jobName} — Failed`,
    body: args.errorMessage.slice(0, 200),
    chatId: args.chatId,
  });
}

export async function scheduleNextRunIfNeeded(
  ctx: ActionCtx,
  job: {
    jobId: Id<"scheduledJobs">;
    recurrence: Recurrence;
    timezone?: string;
    status: string;
    scheduledFunctionId?: Id<"_scheduled_functions">;
    replaceExistingSchedule: boolean;
  },
): Promise<void> {
  if (job.status !== "active") return;

  const nextRunAt = computeNextRunTime(job.recurrence, job.timezone);
  if (nextRunAt === null) return;

  const scheduledId = await ctx.scheduler.runAt(
    nextRunAt,
    internal.scheduledJobs.actions.executeScheduledJob,
    { jobId: job.jobId },
  );

  if (job.replaceExistingSchedule) {
    await ctx.runMutation(
      internal.scheduledJobs.mutations.replaceScheduledFunction,
      {
        jobId: job.jobId,
        nextRunAt,
        scheduledFunctionId: scheduledId,
        previousScheduledFunctionId: job.scheduledFunctionId,
      },
    );
    return;
  }

  await ctx.runMutation(
    internal.scheduledJobs.mutations.updateNextRun,
    {
      jobId: job.jobId,
      nextRunAt,
      scheduledFunctionId: scheduledId,
    },
  );
}
