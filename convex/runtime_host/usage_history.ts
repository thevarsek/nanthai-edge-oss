import { v } from "convex/values";
import { query, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { authenticateRuntimeHost } from "./security";
import { createMonth, mergeMonthlyUsage, type MonthlyUsage, type UsageObservation } from "../../shared/runtime_usage.mjs";

export type UsageHistoryArgs = { deviceId: string; credentialId: string; credential: string; cursor: string | null; throughMs?: number };
export type UsageHistoryPage = { userId: string; deviceId: string; throughMs: number; months: MonthlyUsage[]; isDone: boolean; continueCursor: string };

export async function listForHostHandler(ctx: QueryCtx, args: UsageHistoryArgs): Promise<UsageHistoryPage> {
  const { device } = await authenticateRuntimeHost(ctx, args);
  const throughMs = args.throughMs ?? Date.now();
  const result = await ctx.db.query("usageRecords")
    .withIndex("by_user_runtime_device", q => q.eq("userId", device.userId)
      .eq("runtimeDeviceId", device.deviceId).lte("createdAt", throughMs))
    .order("desc").paginate({ cursor: args.cursor, numItems: 100 });
  const months = await Promise.all(result.page.map(async record => {
    const job = record.source === undefined || record.source === "runtime_generation"
      ? await ctx.db.query("generationJobs").withIndex("by_message", q => q.eq("messageId", record.messageId)).first() : null;
    return createMonth(new Date(record.createdAt).toISOString().slice(0, 7), observation(record, job?.runtimeUsage));
  }));
  return { userId: device.userId, deviceId: device.deviceId, throughMs,
    months: mergeMonthlyUsage(months), isDone: result.isDone, continueCursor: result.continueCursor };
}

export const listForHost = query({
  args: { deviceId: v.string(), credentialId: v.string(), credential: v.string(),
    cursor: v.union(v.string(), v.null()), throughMs: v.optional(v.number()) },
  handler: listForHostHandler,
});

function observation(record: Doc<"usageRecords">, runtime: Doc<"generationJobs">["runtimeUsage"]): UsageObservation {
  let cost: UsageObservation["cost"] = { source: "unpriced", reason: "Canonical price unavailable" };
  if (record.cost !== undefined && record.costAttribution === "provider_reported") {
    cost = { source: "provider_reported", amount: record.cost, currency: runtime?.costCurrency ?? "USD" };
  } else if (record.cost !== undefined && record.costAttribution === "api_equivalent_estimate") {
    cost = { source: "api_equivalent_estimate", amount: record.cost,
      currency: runtime?.costCurrency ?? "USD", pricingVersion: runtime?.pricingVersion ?? null };
  }
  return { occurredAtMs: record.createdAt, provider: record.provider ?? null, modelId: record.modelId,
    tokens: runtime ? { input: runtime.inputTokens ?? null, output: runtime.outputTokens ?? null,
      cachedInput: runtime.cachedInputTokens ?? null, reasoning: runtime.reasoningTokens ?? null, total: runtime.totalTokens ?? null }
      : { input: record.promptTokens, output: record.completionTokens, cachedInput: record.cachedTokens ?? null,
        reasoning: record.reasoningTokens ?? null, total: record.totalTokens }, cost };
}
