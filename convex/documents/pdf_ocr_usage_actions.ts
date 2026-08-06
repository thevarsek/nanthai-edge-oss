"use node";

import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  fetchGenerationData,
  type GenerationData,
} from "../chat/actions_fetch_usage";
import type { NonStreamResult } from "../lib/openrouter";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  hasExactUsageCost,
  hasValidUsage,
  optionalUsageDetails,
  PDF_OCR_ENGINE,
  type PdfOcrAccountingStatus,
} from "./pdf_ocr_fallback";

export interface PdfOcrUsageScope extends Record<string, unknown> {
  versionId: Id<"documentVersions">;
  storageId: Id<"_storage">;
  userId: string;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  modelId: string;
  ocrEngine: typeof PDF_OCR_ENGINE;
}

export interface ReconcilePdfOcrUsageArgs extends PdfOcrUsageScope {
  generationId: string;
}

type PdfOcrReconciliationStatus = Extract<
  PdfOcrAccountingStatus,
  "recorded" | "usage_unavailable" | "record_scheduled" | "record_failed"
>;

type AncillaryUsageArgs = {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost: number;
  source: "pdf_ocr";
  generationId?: string;
  idempotencyKey?: string;
} & Record<string, number | string | boolean | undefined>;

const reconcilePdfOcrUsageRef = makeFunctionReference<
  "action",
  ReconcilePdfOcrUsageArgs,
  PdfOcrReconciliationStatus
>("documents/pdf_ocr_usage_actions:reconcilePdfOcrUsage") as unknown as FunctionReference<
  "action",
  "internal",
  ReconcilePdfOcrUsageArgs,
  PdfOcrReconciliationStatus
>;

export function pdfOcrIdempotencyKey(
  scope: Pick<PdfOcrUsageScope, "versionId" | "storageId" | "ocrEngine">,
  generationId: string | null,
): string {
  const attemptId = generationId?.trim() || "unattributed";
  return `pdf_ocr:${scope.versionId}:${scope.storageId}:${scope.ocrEngine}:${attemptId}`;
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
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      details[key] = value;
    }
  }
  return details;
}

function buildUsageArgs(
  scope: PdfOcrUsageScope,
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    details?: Record<string, number | boolean>;
  },
  generationId: string | null,
): AncillaryUsageArgs {
  const canonicalGenerationId = generationId?.trim() || undefined;
  const generationFields = canonicalGenerationId
    ? { generationId: canonicalGenerationId }
    : {};
  return {
    messageId: scope.messageId,
    chatId: scope.chatId,
    userId: scope.userId,
    modelId: scope.modelId,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cost: usage.cost,
    ...(usage.details ?? {}),
    source: "pdf_ocr",
    idempotencyKey: pdfOcrIdempotencyKey(scope, canonicalGenerationId ?? null),
    ...generationFields,
  };
}

async function storeWithScheduledFallback(
  ctx: ActionCtx,
  scope: PdfOcrUsageScope,
  usageArgs: AncillaryUsageArgs,
): Promise<PdfOcrReconciliationStatus> {
  try {
    await ctx.runMutation(internal.chat.mutations.storeAncillaryCost, usageArgs);
    return "recorded";
  } catch (error) {
    console.error("[documents:pdf_ocr] ancillary usage recording failed", {
      versionId: scope.versionId,
      generationId: usageArgs.generationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await ctx.scheduler.runAfter(
      0,
      internal.chat.mutations.storeAncillaryCost,
      usageArgs,
    );
    console.warn("[documents:pdf_ocr] scheduled ancillary usage write", {
      versionId: scope.versionId,
      generationId: usageArgs.generationId,
    });
    return "record_scheduled";
  } catch (error) {
    console.error("[documents:pdf_ocr] ancillary usage scheduling failed", {
      versionId: scope.versionId,
      generationId: usageArgs.generationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return "record_failed";
}

export async function recordPdfOcrUsage(
  ctx: ActionCtx,
  scope: PdfOcrUsageScope,
  result: NonStreamResult,
): Promise<PdfOcrAccountingStatus> {
  const usage = result.usage;
  if (hasValidUsage(usage) && hasExactUsageCost(usage)) {
    return await storeWithScheduledFallback(ctx, scope, buildUsageArgs(scope, {
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      cost: usage.cost,
      details: optionalUsageDetails(usage),
    }, result.generationId));
  }

  const generationId = result.generationId?.trim();
  if (!generationId) {
    console.warn("[documents:pdf_ocr] usage unavailable without generation ID", {
      versionId: scope.versionId,
    });
    return "usage_unavailable";
  }

  try {
    await ctx.scheduler.runAfter(0, reconcilePdfOcrUsageRef, {
      ...scope,
      generationId,
    });
    return "authoritative_cost_required";
  } catch (error) {
    console.error("[documents:pdf_ocr] reconciliation scheduling failed", {
      versionId: scope.versionId,
      generationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return "record_failed";
  }
}

const defaultReconcileDeps = {
  getRequiredUserOpenRouterApiKey,
  fetchGenerationData,
};

export type ReconcilePdfOcrUsageDeps = typeof defaultReconcileDeps;

export function createReconcilePdfOcrUsageDepsForTest(
  overrides: Partial<ReconcilePdfOcrUsageDeps> = {},
): ReconcilePdfOcrUsageDeps {
  return { ...defaultReconcileDeps, ...overrides };
}

export async function reconcilePdfOcrUsageHandler(
  ctx: ActionCtx,
  args: ReconcilePdfOcrUsageArgs,
  deps: ReconcilePdfOcrUsageDeps = defaultReconcileDeps,
): Promise<PdfOcrReconciliationStatus> {
  const apiKey = await deps.getRequiredUserOpenRouterApiKey(ctx, args.userId);
  const data = await deps.fetchGenerationData(apiKey, args.generationId);
  if (!data || typeof data.total_cost !== "number" ||
      !Number.isFinite(data.total_cost) || data.total_cost < 0) {
    console.warn("[documents:pdf_ocr] authoritative cost unavailable", {
      versionId: args.versionId,
      generationId: args.generationId,
    });
    return "usage_unavailable";
  }

  const promptTokens = data.tokens_prompt ?? 0;
  const completionTokens = data.tokens_completion ?? 0;
  return await storeWithScheduledFallback(ctx, args, buildUsageArgs(args, {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    cost: data.total_cost,
    details: generationDetails(data),
  }, args.generationId));
}

export const reconcilePdfOcrUsage = internalAction({
  args: {
    versionId: v.id("documentVersions"),
    storageId: v.id("_storage"),
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    modelId: v.string(),
    ocrEngine: v.literal(PDF_OCR_ENGINE),
    generationId: v.string(),
  },
  returns: v.union(
    v.literal("recorded"),
    v.literal("usage_unavailable"),
    v.literal("record_scheduled"),
    v.literal("record_failed"),
  ),
  handler: reconcilePdfOcrUsageHandler,
});
