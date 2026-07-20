import { type EventId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { generationResumeEventValue } from "../chat/workflow_resume_handlers";
import { durableWorkflow } from "../execution/components";
import { isSettledWorkflowSignalError } from
  "../execution/workflow_signal_errors";

const MAX_RETRY_DELAY_MS = 30 * 60 * 1_000;

async function signalCurrentWorkflowResume(
  ctx: MutationCtx,
  args: { batchId: Id<"drivePickerBatches">; userId: string },
): Promise<boolean> {
  const batch = await ctx.db.get(args.batchId);
  if (!batch || batch.userId !== args.userId) return false;
  const params = batch.paramsSnapshot as { workflowResumeEventId?: string } | undefined;
  const eventId = params?.workflowResumeEventId;
  if (!eventId) return false;
  if (batch.workflowResumeSignaledEventId === eventId) return true;
  try {
    await durableWorkflow.sendEvent(ctx, {
      id: eventId as EventId<string>,
      validator: generationResumeEventValue,
      value: {
        mode: "fresh",
        drivePickerBatchId: batch.status === "resuming" ? String(batch._id) : undefined,
      },
    });
  } catch (error) {
    if (!isSettledWorkflowSignalError(error)) return false;
  }
  await ctx.db.patch(batch._id, {
    workflowResumeSignaledEventId: eventId,
    workflowResumeSignaledAt: Date.now(),
  });
  return true;
}

export const getResumeOwnership = internalQuery({
  args: {
    batchId: v.id("drivePickerBatches"),
    userId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      orchestrationEngine: v.optional(v.union(
        v.literal("legacy_scheduler"),
        v.literal("convex_workflow"),
        v.literal("convex_workpool"),
        v.literal("runtime_adapter"),
      )),
      workflowResumeEventId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== args.userId) return null;
    const job = await ctx.db.get(batch.parentJobId);
    const attempt = job?.executionAttemptId
      ? await ctx.db.get(job.executionAttemptId)
      : null;
    const params = batch.paramsSnapshot as { workflowResumeEventId?: string } | undefined;
    return {
      orchestrationEngine: attempt?.orchestrationEngine,
      workflowResumeEventId: params?.workflowResumeEventId,
    };
  },
});

export const signalWorkflowResume = internalMutation({
  args: { batchId: v.id("drivePickerBatches"), userId: v.string() },
  returns: v.boolean(),
  handler: signalCurrentWorkflowResume,
});

export const retryWorkflowResumeGate = internalMutation({
  args: {
    batchId: v.id("drivePickerBatches"),
    userId: v.string(),
    attempt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== args.userId || batch.status !== "resuming") return false;
    const job = await ctx.db.get(batch.parentJobId);
    const executionAttempt = job?.executionAttemptId
      ? await ctx.db.get(job.executionAttemptId)
      : null;
    const params = batch.paramsSnapshot as { workflowResumeEventId?: string } | undefined;
    if (
      executionAttempt?.orchestrationEngine === "legacy_scheduler"
      || (!executionAttempt?.orchestrationEngine && !params?.workflowResumeEventId)
    ) return false;
    if (
      params?.workflowResumeEventId
      && batch.workflowResumeSignaledEventId === params.workflowResumeEventId
    ) return true;
    const retryDelayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      60_000 * (2 ** Math.min(args.attempt, 5)),
    );
    await ctx.scheduler.runAfter(
      retryDelayMs,
      internal.drive_picker.ownership.retryWorkflowResumeGate,
      { ...args, attempt: args.attempt + 1 },
    );
    return await signalCurrentWorkflowResume(ctx, args);
  },
});
