import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { captureBackendAIOperationCompleted, captureBackendAIOperationFailed } from "../analytics/backend_events";
import { MODEL_IDS } from "../lib/model_constants";
import { callJevDecisions, DecisionError, type DecisionRequest, type DecisionResult } from "./client";
type DecisionUseCase = "speakers" | "discussion" | "moderator" | "memory";

type DecisionContext = Partial<Pick<ActionCtx, "scheduler" | "runMutation">>;
export interface DecisionCallArgs extends DecisionRequest {
  useCase: DecisionUseCase;
  apiKey: string;
  userId: string;
  chatId: Id<"chats">;
  messageId?: Id<"messages">;
  requireZdr: boolean;
  recordCost?: boolean;
}

export async function tryJevDecision(ctx: DecisionContext, args: DecisionCallArgs): Promise<DecisionResult | null> {
  const telemetry = {
    userId: args.userId, chatId: String(args.chatId), messageId: args.messageId ? String(args.messageId) : undefined,
    operation: `jev_${args.useCase}`, source: "m60", modelId: MODEL_IDS.jevDecision,
    properties: { policy_version: "m60-v1", zdr_required: args.requireZdr },
  };
  try {
    const result = await callJevDecisions(args.apiKey, args, { requireZdr: args.requireZdr });
    if (ctx.scheduler) await captureBackendAIOperationCompleted({ scheduler: ctx.scheduler }, {
      ...telemetry, modelId: result.modelId, usage: result.usage, durationMs: result.durationMs,
      properties: { ...telemetry.properties, provider: result.provider ?? null, decision_request_id: result.requestId ?? null },
    });
    await recordDecisionUsage(ctx, args, result);
    return result;
  } catch (error) {
    const metadata = error instanceof DecisionError ? error.metadata : undefined;
    if (metadata) await recordDecisionUsage(ctx, args, metadata);
    const category = error instanceof DecisionError ? error.category : "decision_failure";
    console.warn("[m60:jev] using existing helper", { useCase: args.useCase, category });
    if (ctx.scheduler) await captureBackendAIOperationFailed({ scheduler: ctx.scheduler }, {
      ...telemetry, usage: metadata?.usage, durationMs: metadata?.durationMs, error: new DecisionError(category), properties: { ...telemetry.properties, fallback_reason: category, provider: metadata?.provider ?? null, decision_request_id: metadata?.requestId ?? null },
    });
    return null;
  }
}

async function recordDecisionUsage(ctx: DecisionContext, args: DecisionCallArgs, result: Omit<DecisionResult, "answers">): Promise<void> {
  // Decisions IDs are not chat Generation IDs: never enqueue Generations lookup.
  if (!ctx.runMutation || !args.messageId || !result.usage || args.recordCost === false) return;
  try {
    await ctx.runMutation(internal.chat.mutations.storeAncillaryCost, {
      userId: args.userId, chatId: args.chatId, messageId: args.messageId, modelId: result.modelId,
      ...result.usage, source: `jev_${args.useCase}`,
      idempotencyKey: result.requestId ? `jev:${result.requestId}` : undefined,
    });
  } catch {
    // The completed/failed operation event retains reported usage for reconciliation.
    console.warn("[m60:jev] usage persistence failed", { useCase: args.useCase, requestId: result.requestId });
  }
}
