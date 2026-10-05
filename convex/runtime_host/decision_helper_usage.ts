import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { runtimeUsageArgs } from "./chat_terminal_ingestion";

export async function recordDecisionHelperUsage(
  ctx: MutationCtx, task: Doc<"runtimeHelperTasks">, attempt: Doc<"executionAttempts">, eventId: string,
): Promise<void> {
  const observed = runtimeUsageArgs(task.runtimeUsage);
  if (!observed) return;
  const idempotencyKey = `runtime-decision:${String(task._id)}:${attempt.fence}:${eventId}`;
  const existing = await ctx.db.query("usageRecords").withIndex("by_idempotency_key", q => q.eq("idempotencyKey", idempotencyKey)).first();
  if (existing) return;
  await ctx.db.insert("usageRecords", {
    userId: task.userId, chatId: task.chatId, messageId: task.sourceMessageId,
    modelId: observed.modelId ?? attempt.modelId ?? "runtime/unknown",
    provider: observed.provider, ...observed.usage,
    costAttribution: observed.costAttribution, runtimeDeviceId: attempt.deviceId,
    runtimeAdapterId: attempt.adapterId, source: "runtime_decision", idempotencyKey, createdAt: Date.now(),
  });
}
