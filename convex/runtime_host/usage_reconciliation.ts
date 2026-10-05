import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { runtimeUsageArgs } from "./chat_terminal_ingestion";

/** Reconcile observations already accepted by the original runtime attempt. */
export async function reconcileRuntimeUsageHandler(
  ctx: MutationCtx,
  args: { jobId: Id<"generationJobs"> },
) {
  const job = await ctx.db.get(args.jobId);
  if (!job || !["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
    throw new Error("TERMINAL_RUNTIME_JOB_REQUIRED");
  }
  const observed = runtimeUsageArgs(job.runtimeUsage);
  if (!observed || !job.executionAttemptId) return null;
  const [attempt, message] = await Promise.all([
    ctx.db.get(job.executionAttemptId), ctx.db.get(job.messageId),
  ]);
  if (!attempt || attempt.placement !== "local" || attempt.userId !== job.userId
    || attempt.runId !== job.executionRunId || !message || message.chatId !== job.chatId) {
    throw new Error("RUNTIME_USAGE_OWNER_MISMATCH");
  }
  const existing = (await ctx.db.query("usageRecords")
    .withIndex("by_message", q => q.eq("messageId", job.messageId)).collect())
    .filter(row => row.source === "runtime_generation");
  if (existing.length > 1) throw new Error("DUPLICATE_RUNTIME_USAGE_REQUIRES_RECONCILIATION");
  const record = {
    userId: job.userId, chatId: job.chatId, messageId: job.messageId,
    modelId: observed.modelId ?? job.modelId, ...observed.usage,
    provider: observed.provider, costAttribution: observed.costAttribution,
    runtimeDeviceId: attempt.deviceId, runtimeAdapterId: attempt.adapterId,
    source: "runtime_generation", idempotencyKey: `runtime-generation:${job._id}`,
  };
  if (existing[0]) {
    await ctx.db.patch(existing[0]._id, record);
    return existing[0]._id;
  }
  return await ctx.db.insert("usageRecords", {
    ...record, createdAt: job.completedAt ?? job.createdAt,
  });
}

export const reconcile = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: reconcileRuntimeUsageHandler,
});
