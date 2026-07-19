"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { executeSinglePerplexitySearch } from "./helpers";

export const runResearchSearchQuery = internalAction({
  args: {
    taskId: v.id("researchSearchTasks"),
    batchId: v.id("researchSearchBatches"),
    userId: v.string(),
    query: v.string(),
    searchModel: v.string(),
    maxTokens: v.number(),
    requireZdr: v.boolean(),
    sessionId: v.id("searchSessions"),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const currentBefore = await ctx.runQuery(
      internal.search.queries.isResearchExecutionCurrent,
      {
        sessionId: args.sessionId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      },
    );
    if (!currentBefore) throw new Error("RESEARCH_EXECUTION_STALE");
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const result = await executeSinglePerplexitySearch(
      args.query,
      args.searchModel,
      apiKey,
      { maxTokens: args.maxTokens, requireZdr: args.requireZdr },
    );
    const currentAfter = await ctx.runQuery(
      internal.search.queries.isResearchExecutionCurrent,
      {
        sessionId: args.sessionId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      },
    );
    if (!currentAfter) throw new Error("RESEARCH_EXECUTION_STALE");
    await ctx.runMutation(
      internal.search.research_fanout_mutations.recordResearchSearchTaskResult,
      {
        taskId: args.taskId,
        batchId: args.batchId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
        result,
      },
    );
    return result;
  },
});
