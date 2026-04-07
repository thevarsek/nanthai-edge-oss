import { v } from "convex/values";
import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { HTTP_REFERER, X_TITLE } from "../lib/openrouter_constants";
import {
  continueScheduledJobExecutionHandler,
  executeScheduledJobHandler,
  failScheduledJobExecutionHandler,
} from "./actions_handlers";

export const executeScheduledJob = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    invocationSource: v.optional(v.union(v.literal("scheduled"), v.literal("manual"))),
  },
  handler: executeScheduledJobHandler,
});

export const continueScheduledJobExecution = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    chatId: v.id("chats"),
    executionId: v.string(),
    completedStepIndex: v.number(),
    assistantMessageId: v.id("messages"),
  },
  handler: continueScheduledJobExecutionHandler,
});

export const failScheduledJobExecution = internalAction({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    error: v.string(),
  },
  handler: failScheduledJobExecutionHandler,
});

/**
 * Fetch the user's OpenRouter credit balance server-side.
 * The API key is stored in Convex (userSecrets) and cannot be accessed
 * from the browser, so this action proxies the OpenRouter credits API.
 */
export const fetchOpenRouterCredits = action({
  args: {},
  handler: async (ctx): Promise<{ balance: number }> => {
    const { userId } = await requireAuth(ctx);

    const apiKey: string | null = await ctx.runQuery(
      internal.scheduledJobs.queries.getUserApiKey,
      { userId },
    );
    if (!apiKey) {
      throw new Error("No OpenRouter API key found. Please connect OpenRouter first.");
    }

    const resp = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": HTTP_REFERER,
        "X-Title": X_TITLE,
      },
    });
    if (!resp.ok) {
      throw new Error(`OpenRouter credits API returned ${resp.status}`);
    }
    const data = (await resp.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const totalCredits = data.data?.total_credits ?? 0;
    const totalUsage = data.data?.total_usage ?? 0;
    return { balance: totalCredits - totalUsage };
  },
});
