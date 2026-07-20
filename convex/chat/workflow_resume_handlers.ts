import { type EventId } from "@convex-dev/workflow";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { isSettledWorkflowSignalError } from
  "../execution/workflow_signal_errors";
import {
  saveGenerationContinuationHandler,
  type SaveGenerationContinuationArgs,
} from "./mutations_generation_continuation_handlers";

export const generationResumeEventValue = v.object({
  mode: v.union(v.literal("checkpoint"), v.literal("fresh")),
  drivePickerBatchId: v.optional(v.string()),
});

export type GenerationResumeEventValue = {
  mode: "checkpoint" | "fresh";
  drivePickerBatchId?: string;
};

export function isIgnorableResumeSignalError(error: unknown): boolean {
  return isSettledWorkflowSignalError(error);
}

type CompleteDeferredToolArgs = {
  jobId: Id<"generationJobs">;
  userId: string;
  toolCallId: string;
  toolName: string;
  result: string;
  isError?: boolean;
  eventId: string;
};

export async function completeDeferredToolHandler(
  ctx: MutationCtx,
  args: CompleteDeferredToolArgs,
): Promise<"resumed" | "duplicate" | "missing" | "terminal"> {
  const [job, continuation] = await Promise.all([
    ctx.db.get(args.jobId),
    ctx.db
      .query("generationContinuations")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .first(),
  ]);
  if (!job || job.userId !== args.userId) return "missing";
  if (["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
    return "terminal";
  }
  if (!continuation || continuation.userId !== args.userId) return "missing";

  const storedResult = {
    toolCallId: args.toolCallId,
    toolName: args.toolName,
    result: args.result,
    isError: args.isError === true ? true : undefined,
  };
  const toolResults = [...(continuation.toolResults ?? [])];
  const existingIndex = toolResults.findIndex((entry) =>
    entry.toolCallId === args.toolCallId
  );
  const isDuplicate = existingIndex >= 0
    && toolResults[existingIndex]?.result === args.result
    && toolResults[existingIndex]?.isError === storedResult.isError;
  if (continuation.deferredResumeEventId !== args.eventId) {
    return isDuplicate ? "duplicate" : "missing";
  }
  if (
    continuation.executionAttemptId !== job.executionAttemptId
    || continuation.executionFence !== job.executionFence
  ) return "missing";
  const expectedToolCall = (continuation.toolCalls ?? []).find(
    (entry) => entry.id === args.toolCallId,
  );
  if (!expectedToolCall || expectedToolCall.name !== args.toolName) return "missing";
  if (existingIndex >= 0) toolResults[existingIndex] = storedResult;
  else toolResults.push(storedResult);

  const requestMessages = (continuation.requestMessages as Array<Record<string, unknown>>)
    .map((message) => message.role === "tool" && message.tool_call_id === args.toolCallId
      ? { ...message, content: args.result }
      : message);
  await ctx.db.patch(continuation._id, {
    requestMessages,
    toolResults,
    status: "waiting",
    deferredResumeEventId: undefined,
    deferredOwnership: undefined,
    claimedAt: undefined,
    leaseExpiresAt: undefined,
    updatedAt: Date.now(),
  });
  await durableWorkflow.sendEvent(ctx, {
    id: args.eventId as EventId<string>,
    validator: generationResumeEventValue,
    value: { mode: "checkpoint" },
  }).catch((error: unknown) => {
    if (!isIgnorableResumeSignalError(error)) throw error;
  });
  return isDuplicate ? "duplicate" : "resumed";
}

export async function installDeferredCheckpointAndSignalHandler(
  ctx: MutationCtx,
  args: SaveGenerationContinuationArgs & {
    eventId: string;
    resumeBatchId?: Id<"subagentBatches">;
  },
): Promise<"resumed" | "duplicate" | "missing"> {
  const [job, existing, resumeBatch] = await Promise.all([
    ctx.db.get(args.jobId),
    ctx.db
      .query("generationContinuations")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .first(),
    args.resumeBatchId ? ctx.db.get(args.resumeBatchId) : null,
  ]);
  if (
    resumeBatch
    && resumeBatch.resumeDeliveredEventId === args.eventId
    && resumeBatch.resumeDeliveredAt !== undefined
  ) return "duplicate";
  if (
    args.resumeBatchId
    && (
      !resumeBatch
      || resumeBatch.parentJobId !== args.jobId
      || resumeBatch.userId !== args.userId
      || resumeBatch.status !== "resuming"
    )
  ) return "missing";
  if (!job || job.userId !== args.userId || !existing) return "missing";
  if (existing.roundKey !== args.checkpoint.roundKey) return "missing";
  const expectedAttemptId = args.checkpoint.group.executionAttemptId;
  const expectedFence = args.checkpoint.group.executionFence;
  if (
    existing.deferredResumeEventId !== args.eventId
    || existing.executionAttemptId !== expectedAttemptId
    || existing.executionFence !== expectedFence
    || job.executionAttemptId !== expectedAttemptId
    || job.executionFence !== expectedFence
  ) return "missing";
  const { eventId: _eventId, resumeBatchId: _resumeBatchId, ...saveArgs } = args;
  await saveGenerationContinuationHandler(ctx, saveArgs);
  let result: "resumed" | "duplicate" = "resumed";
  try {
    await durableWorkflow.sendEvent(ctx, {
      id: args.eventId as EventId<string>,
      validator: generationResumeEventValue,
      value: { mode: "checkpoint" },
    });
  } catch (error) {
    if (isIgnorableResumeSignalError(error)) result = "duplicate";
    else throw error;
  }
  if (resumeBatch) {
    const now = Date.now();
    await ctx.db.patch(resumeBatch._id, {
      status: "completed",
      resumeDeliveredEventId: args.eventId,
      resumeDeliveredAt: now,
      updatedAt: now,
    });
  }
  return result;
}
