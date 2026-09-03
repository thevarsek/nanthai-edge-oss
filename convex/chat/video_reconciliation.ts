"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { pollVideoJobStatus } from "../lib/openrouter_video";
import { recordMediaGenerationUsage } from "../tools/media_generation_usage";

/**
 * Polls a cancelled provider job without publishing its output. OpenRouter's
 * video API has no cancellation endpoint, so physical quiescence means the
 * provider reports a terminal state, not merely that our Workflow stopped.
 */
export const reconcileCancelledProvider = internalAction({
  args: { videoJobId: v.id("videoJobs") },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const job = await ctx.runQuery(internal.chat.queries.getVideoJobInternal, {
      videoJobId: args.videoJobId,
    });
    if (!job) return true;
    if (job.providerTerminalAt !== undefined) return true;
    if (!job.openRouterJobId) return true;
    try {
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, job.userId);
      const result = await pollVideoJobStatus(apiKey, job.openRouterJobId);
      if (result.status !== "completed" && result.status !== "failed") return false;
      await recordMediaGenerationUsage(ctx, {
        messageId: job.messageId,
        chatId: job.chatId,
        userId: job.userId,
        modelId: job.model,
        source: job.toolCallId ? "media_tool_video" : "media_message_video",
        idempotencyKey: `${String(job._id)}:usage`,
      }, result.usage ? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: result.usage.cost,
        isByok: result.usage.is_byok,
      } : null, result.generation_id ?? null);
      await ctx.runMutation(internal.chat.mutations.markVideoProviderTerminal, {
        videoJobId: args.videoJobId,
        status: result.status,
        generationId: result.generation_id,
        cost: result.usage?.cost,
        isByok: result.usage?.is_byok,
      });
      return true;
    } catch {
      // Credentials and transient provider errors do not prove quiescence.
      return false;
    }
  },
});
