import type { MutationCtx } from "../_generated/server";
import type { NonTerminalAdapterEvent } from "./protocol_adapter_events";
import type { RuntimeChatEventContext } from "./chat_terminal_ingestion";

type UsageEvent = Extract<NonTerminalAdapterEvent, { type: "usage_reported" }>;

// Codex reports child inference separately from its parent's token totals.
export async function recordNativeAgentUsage(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: UsageEvent,
): Promise<void> {
  const nativeThreadId = event.nativeAgentThreadId;
  if (!nativeThreadId) throw new Error("RUNTIME_NATIVE_AGENT_START_REQUIRED");
  const group = await ctx.db.query("runtimeNativeAgentGroups")
    .withIndex("by_attempt", q => q.eq("attemptId", context.attempt._id)).unique();
  const agent = group && await ctx.db.query("runtimeNativeAgents")
    .withIndex("by_group_thread", q => q.eq("groupId", group._id)
      .eq("nativeThreadId", nativeThreadId)).unique();
  if (!group || !agent || group.runId !== context.run._id
    || group.fence !== context.attempt.fence || group.messageId !== context.job.messageId) {
    throw new Error("RUNTIME_NATIVE_AGENT_START_REQUIRED");
  }
  const idempotencyKey = `runtime-native-usage:${String(context.attempt._id)}:${event.eventId}`;
  const existing = await ctx.db.query("usageRecords")
    .withIndex("by_idempotency_key", q => q.eq("idempotencyKey", idempotencyKey)).first();
  if (existing) return;
  await ctx.db.insert("usageRecords", {
    userId: context.run.userId,
    chatId: context.job.chatId,
    messageId: context.job.messageId,
    modelId: event.actualModel?.modelId ?? "unknown",
    provider: event.actualModel?.provider ?? undefined,
    promptTokens: event.tokens.input ?? 0,
    completionTokens: event.tokens.output ?? 0,
    totalTokens: event.tokens.total ?? 0,
    cachedTokens: event.tokens.cachedInput ?? undefined,
    reasoningTokens: event.tokens.reasoning ?? undefined,
    costAttribution: event.cost.source,
    cost: event.cost.source === "unpriced" ? undefined : event.cost.amount,
    runtimeDeviceId: context.attempt.deviceId,
    runtimeAdapterId: context.attempt.adapterId,
    source: "runtime_native_child",
    idempotencyKey,
    createdAt: event.occurredAt,
  });
}
