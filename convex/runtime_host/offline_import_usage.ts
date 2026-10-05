import type { Id, Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { NonTerminalAdapterEventSchema } from "./protocol_adapter_events";
import { aggregateRuntimeUsage } from "./usage_aggregation";
import { runtimeUsageArgs } from "./chat_terminal_ingestion";

export async function importOfflineUsage(ctx: MutationCtx, args: {
  json: string; localResultId: string; messageId: Id<"messages">; chatId: Id<"chats">;
  userId: string; deviceId: string; adapterId: string; modelId?: string;
}) {
  const values = JSON.parse(args.json) as unknown;
  if (!Array.isArray(values)) throw new Error("INVALID_OFFLINE_USAGE");
  const seen = new Set<string>();
  let root: Doc<"generationJobs">["runtimeUsage"];
  for (const value of values) {
    const event = NonTerminalAdapterEventSchema.parse(value);
    if (event.type !== "usage_reported" || event.runId !== `local-${args.localResultId}`
      || event.attemptId !== `local-attempt-${args.localResultId}` || event.fence !== 1) throw new Error("OFFLINE_USAGE_OWNER_MISMATCH");
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    if (!event.nativeAgentThreadId) { root = aggregateRuntimeUsage(root, event); continue; }
    await ctx.db.insert("usageRecords", {
      userId: args.userId, chatId: args.chatId, messageId: args.messageId,
      modelId: event.actualModel?.modelId ?? "unknown", provider: event.actualModel?.provider ?? undefined,
      promptTokens: event.tokens.input ?? 0, completionTokens: event.tokens.output ?? 0,
      totalTokens: event.tokens.total ?? 0, cachedTokens: event.tokens.cachedInput ?? undefined,
      reasoningTokens: event.tokens.reasoning ?? undefined, costAttribution: event.cost.source,
      cost: event.cost.source === "unpriced" || event.cost.currency !== "USD" ? undefined : event.cost.amount,
      runtimeDeviceId: args.deviceId, runtimeAdapterId: args.adapterId, source: "runtime_native_child",
      idempotencyKey: `offline-child:${args.localResultId}:${event.eventId}`, createdAt: event.occurredAt,
    });
  }
  const observed = runtimeUsageArgs(root);
  if (!observed) return;
  await ctx.db.patch(args.messageId, { usage: observed.usage, modelId: observed.modelId ?? args.modelId });
  await ctx.db.insert("usageRecords", {
    userId: args.userId, chatId: args.chatId, messageId: args.messageId,
    modelId: observed.modelId ?? args.modelId ?? "unknown", ...observed.usage,
    provider: observed.provider, costAttribution: observed.costAttribution,
    runtimeDeviceId: args.deviceId, runtimeAdapterId: args.adapterId, source: "runtime_generation",
    idempotencyKey: `offline-root:${args.localResultId}`, createdAt: Date.now(),
  });
}
