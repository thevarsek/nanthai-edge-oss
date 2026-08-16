import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { OpenRouterUsage } from "../lib/openrouter";

export async function recordSchedulerUsage(
  ctx: MutationCtx,
  args: {
    userId: string;
    chatId: Id<"chats">;
    messageId: Id<"messages">;
    decisionKey: string;
    modelId?: string;
    generationId?: string;
    usage?: OpenRouterUsage;
    now: number;
  },
): Promise<Id<"usageRecords"> | undefined> {
  if (!args.usage || !args.modelId) return undefined;
  const idempotencyKey = `collaboration-scheduler:${args.decisionKey}`;
  const existing = await ctx.db
    .query("usageRecords")
    .withIndex("by_idempotency_key", (query) =>
      query.eq("idempotencyKey", idempotencyKey)
    )
    .unique();
  if (existing) return existing._id;
  let cost = args.usage.cost;
  if (cost === undefined) {
    const model = await ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (query) => query.eq("modelId", args.modelId!))
      .first();
    if (model?.inputPricePer1M != null && model.outputPricePer1M != null) {
      cost =
        (args.usage.promptTokens * model.inputPricePer1M) / 1_000_000 +
        (args.usage.completionTokens * model.outputPricePer1M) / 1_000_000;
    }
  }
  return await ctx.db.insert("usageRecords", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    modelId: args.modelId,
    promptTokens: args.usage.promptTokens,
    completionTokens: args.usage.completionTokens,
    totalTokens: args.usage.totalTokens,
    cost,
    isByok: args.usage.isByok,
    cachedTokens: args.usage.cachedTokens,
    cacheWriteTokens: args.usage.cacheWriteTokens,
    reasoningTokens: args.usage.reasoningTokens,
    source: "collaboration_scheduler",
    generationId: args.generationId,
    idempotencyKey,
    createdAt: args.now,
  });
}
