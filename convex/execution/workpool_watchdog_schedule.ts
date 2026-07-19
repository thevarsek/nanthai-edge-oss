import { makeFunctionReference } from "convex/server";
import { type Infer, v } from "convex/values";
import type { MutationCtx } from "../_generated/server";

export const workpoolWatchdogTargetValidator = v.union(
  v.object({
    kind: v.literal("research_search"),
    operationId: v.string(),
    taskId: v.id("researchSearchTasks"),
    batchId: v.id("researchSearchBatches"),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  }),
  v.object({
    kind: v.literal("scheduled_step"),
    operationId: v.string(),
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    stepIndex: v.number(),
    assistantMessageId: v.id("messages"),
  }),
  v.object({
    kind: v.literal("presentation_work"),
    operationId: v.string(),
    runId: v.id("presentationGenerationRuns"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    role: v.string(),
  }),
  v.object({
    kind: v.literal("advisor_consultation"),
    operationId: v.string(),
    runId: v.id("advisorRuns"),
  }),
  v.object({
    kind: v.literal("maintenance_work"),
    operationId: v.string(),
    runId: v.id("executionRuns"),
  }),
  v.object({
    kind: v.literal("background_work"),
    operationId: v.string(),
    runId: v.id("executionRuns"),
  }),
);

export type WorkpoolWatchdogTarget = Infer<typeof workpoolWatchdogTargetValidator>;
const watchdogRef = makeFunctionReference<"mutation">(
  "execution/workpool_completion_watchdog:reconcileWorkpoolCompletion",
);
export const WORKPOOL_WATCHDOG_INITIAL_MS = 11 * 60 * 1_000;
export const WORKPOOL_WATCHDOG_RECHECK_MS = 30 * 60 * 1_000;

export async function scheduleWorkpoolCompletionWatchdog(
  ctx: Pick<MutationCtx, "scheduler">,
  target: WorkpoolWatchdogTarget,
  delayMs = WORKPOOL_WATCHDOG_INITIAL_MS,
): Promise<void> {
  await ctx.scheduler.runAfter(delayMs, watchdogRef, { target });
}
