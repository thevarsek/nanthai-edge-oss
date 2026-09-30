import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { NonStreamResult } from "../lib/openrouter_types";
import { internal } from "../_generated/api";
import { captureBackendAIOperationCompleted } from "../analytics/backend_events";

export async function recordAutonomousHelperUsage(
  ctx: Pick<ActionCtx, "runQuery"> & Partial<Pick<ActionCtx, "scheduler" | "runMutation">>,
  args: { userId: string; chatId: Id<"chats">; modelId: string; source: "autonomous_moderator" | "autonomous_consensus" },
  result: NonStreamResult,
): Promise<void> {
  if (!result.usage) return;
  if (ctx.scheduler) await captureBackendAIOperationCompleted({ scheduler: ctx.scheduler }, {
    ...args, operation: args.source, modelId: result.modelId ?? args.modelId,
    usage: result.usage, openrouterGenerationId: result.generationId,
  });
  if (!ctx.runMutation) return;
  try {
    const context = await ctx.runQuery(internal.autonomous.decision_context.getDecisionContext, { chatId: args.chatId, userId: args.userId });
    if (!context?.messageId) return;
    await ctx.runMutation(internal.chat.mutations.storeAncillaryCost, {
      ...args, modelId: result.modelId ?? args.modelId, messageId: context.messageId,
      ...result.usage, generationId: result.generationId ?? undefined,
    });
  } catch { console.warn("[m60:autonomous] helper usage persistence failed", { source: args.source }); }
}
