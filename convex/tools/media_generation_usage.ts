"use node";

import { v } from "convex/values";
import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  fetchGenerationData,
  type GenerationData,
} from "../chat/actions_fetch_usage";
import type { StoreAncillaryCostArgs } from "../chat/mutations_internal_handlers";
import type { OpenRouterUsage } from "../lib/openrouter_types";
import { getOptionalUserOpenRouterApiKey } from "../lib/user_secrets";

export interface MediaGenerationUsageScope extends Record<string, unknown> {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  modelId: string;
  source: string;
  idempotencyKey: string;
}

export interface ReconcileMediaGenerationUsageArgs
  extends MediaGenerationUsageScope {
  generationId: string;
}

export type MediaGenerationAccountingStatus =
  | "recorded"
  | "reconciliation_scheduled"
  | "usage_unavailable"
  | "record_failed";

const reconcileMediaGenerationUsageRef = makeFunctionReference<
  "action",
  ReconcileMediaGenerationUsageArgs,
  MediaGenerationAccountingStatus
>("tools/media_generation_usage:reconcileMediaGenerationUsage") as unknown as FunctionReference<
  "action",
  "internal",
  ReconcileMediaGenerationUsageArgs,
  MediaGenerationAccountingStatus
>;

function exactCost(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasAuthoritativeCost(usage: OpenRouterUsage): boolean {
  if (!exactCost(usage.cost)) return false;
  if (usage.isByok === false) return true;
  if (usage.isByok === true) return exactCost(usage.upstreamInferenceCost);
  // Inline usage does not consistently identify BYOK responses. Reconcile
  // through the generation endpoint before deciding which cost is billable.
  return false;
}

function generationDetails(data: GenerationData): Record<string, number | boolean> {
  const details: Record<string, number | boolean> = {};
  const entries: Array<[string, number | boolean | null | undefined]> = [
    ["isByok", data.is_byok === true ? true : undefined],
    ["cachedTokens", data.native_tokens_cached],
    ["reasoningTokens", data.native_tokens_reasoning],
    ["imageCompletionTokens", data.native_tokens_completion_images],
    ["upstreamInferenceCost", data.upstream_inference_cost],
    ["cacheDiscount", data.cache_discount],
  ];
  for (const [key, value] of entries) {
    if (
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      details[key] = value;
    }
  }
  return details;
}

function usageArgs(
  scope: MediaGenerationUsageScope,
  usage: OpenRouterUsage,
  generationId: string | null,
): StoreAncillaryCostArgs {
  return {
    messageId: scope.messageId,
    chatId: scope.chatId,
    userId: scope.userId,
    modelId: scope.modelId,
    ...usage,
    source: scope.source,
    idempotencyKey: scope.idempotencyKey,
    ...(generationId ? { generationId } : {}),
  };
}

async function storeUsage(
  ctx: ActionCtx,
  scope: MediaGenerationUsageScope,
  usage: OpenRouterUsage,
  generationId: string | null,
): Promise<MediaGenerationAccountingStatus> {
  const args = usageArgs(scope, usage, generationId);
  try {
    await ctx.runMutation(internal.chat.mutations.storeAncillaryCost, args);
    return "recorded";
  } catch (error) {
    console.warn("[media-generation] usage persistence failed", {
      source: scope.source,
      generationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await ctx.scheduler.runAfter(
      0,
      internal.chat.mutations.storeAncillaryCost,
      args,
    );
    return "reconciliation_scheduled";
  } catch (error) {
    console.warn("[media-generation] usage scheduling failed", {
      source: scope.source,
      generationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "record_failed";
  }
}

export async function recordMediaGenerationUsage(
  ctx: ActionCtx,
  scope: MediaGenerationUsageScope,
  usage: OpenRouterUsage | null,
  generationIdValue: string | null,
): Promise<MediaGenerationAccountingStatus> {
  const generationId = generationIdValue?.trim() || null;
  if (usage && hasAuthoritativeCost(usage)) {
    return await storeUsage(ctx, scope, usage, generationId);
  }

  if (generationId) {
    try {
      await ctx.scheduler.runAfter(
        0,
        reconcileMediaGenerationUsageRef,
        { ...scope, generationId },
      );
      return "reconciliation_scheduled";
    } catch (error) {
      console.warn("[media-generation] reconciliation scheduling failed", {
        source: scope.source,
        generationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return "record_failed";
    }
  }

  // Preserve the existing token-priced fallback when a provider supplies
  // usage but no generation ID or exact media cost.
  if (usage?.isByok === true && !exactCost(usage.upstreamInferenceCost)) {
    return "usage_unavailable";
  }
  if (usage) return await storeUsage(ctx, scope, usage, null);
  return "usage_unavailable";
}

const defaultReconcileDeps = {
  getOptionalUserOpenRouterApiKey,
  fetchGenerationData,
};

export type ReconcileMediaGenerationUsageDeps = typeof defaultReconcileDeps;

export function createReconcileMediaGenerationUsageDepsForTest(
  overrides: Partial<ReconcileMediaGenerationUsageDeps> = {},
): ReconcileMediaGenerationUsageDeps {
  return { ...defaultReconcileDeps, ...overrides };
}

export async function reconcileMediaGenerationUsageHandler(
  ctx: ActionCtx,
  args: ReconcileMediaGenerationUsageArgs,
  deps: ReconcileMediaGenerationUsageDeps = defaultReconcileDeps,
): Promise<MediaGenerationAccountingStatus> {
  const apiKey = await deps.getOptionalUserOpenRouterApiKey(ctx, args.userId);
  if (!apiKey) return "usage_unavailable";
  const data = await deps.fetchGenerationData(
    apiKey,
    args.generationId,
    undefined,
    { acceptCostOnly: true },
  );
  if (
    !data || !exactCost(data.total_cost)
    || (data.is_byok === true && !exactCost(data.upstream_inference_cost))
  ) return "usage_unavailable";

  const promptTokens = data.tokens_prompt ?? 0;
  const completionTokens = data.tokens_completion ?? 0;
  return await storeUsage(ctx, args, {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cost: data.total_cost,
    ...generationDetails(data),
  }, args.generationId);
}

export const reconcileMediaGenerationUsage = internalAction({
  args: {
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    modelId: v.string(),
    source: v.string(),
    idempotencyKey: v.string(),
    generationId: v.string(),
  },
  returns: v.union(
    v.literal("recorded"),
    v.literal("reconciliation_scheduled"),
    v.literal("usage_unavailable"),
    v.literal("record_failed"),
  ),
  handler: reconcileMediaGenerationUsageHandler,
});
