import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertModelSupportsZdr, isZdrEnabled } from "../lib/openrouter_zdr";
import { assertModelAvailable, assertTextGenerationModel } from "../lib/openrouter_modality";
import {
  readQueriesFromPhase,
} from "./workflow_durable";
import { resolveComplexityPreset, resolveSearchMaxTokens } from "./helpers";

export const prepareResearchSearchBatch = internalAction({
  args: {
    sessionId: v.id("searchSessions"),
    userId: v.string(),
    complexity: v.number(),
    phaseOrder: v.number(),
    phaseType: v.union(v.literal("initial_search"), v.literal("depth_iteration")),
    iteration: v.optional(v.number()),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.id("researchSearchBatches"),
  handler: async (ctx, args): Promise<Id<"researchSearchBatches">> => {
    const current = await ctx.runQuery(
      internal.search.queries.isResearchExecutionCurrent,
      {
        sessionId: args.sessionId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      },
    );
    if (!current) throw new Error("RESEARCH_EXECUTION_STALE");
    const sourcePhase = args.phaseType === "initial_search" ? "planning" : "analysis";
    const queries = await readQueriesFromPhase(
      ctx,
      args.sessionId,
      sourcePhase,
      args.iteration,
    );
    if (queries.length === 0) {
      throw new Error(`No queries found for research phase ${args.phaseOrder}`);
    }
    const preset = resolveComplexityPreset("paper", args.complexity);
    const [preferences, capabilities] = await Promise.all([
      ctx.runQuery(internal.chat.queries.getUserPreferences, { userId: args.userId }),
      ctx.runQuery(internal.chat.queries.getModelCapabilities, { modelId: preset.searchModel }),
    ]);
    const requireZdr = isZdrEnabled(preferences);
    assertModelAvailable({
      modelId: preset.searchModel,
      capabilities,
      feature: "Research search",
    });
    assertTextGenerationModel({
      feature: "Research search",
      hasImageGeneration: capabilities?.hasImageGeneration,
      hasVideoGeneration: capabilities?.hasVideoGeneration,
      hasAudioOutput: capabilities?.hasAudioOutput,
    });
    if (requireZdr) {
      assertModelSupportsZdr({
        modelId: preset.searchModel,
        capabilities,
        feature: "Research search",
      });
    }
    return await ctx.runMutation(
      internal.search.research_fanout_mutations.dispatchResearchSearchBatch,
      {
        sessionId: args.sessionId,
        userId: args.userId,
        phaseOrder: args.phaseOrder,
        phaseType: args.phaseType,
        iteration: args.iteration,
        queries,
        searchModel: preset.searchModel,
        maxTokens: resolveSearchMaxTokens("paper", args.complexity, preset.searchModel),
        requireZdr,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      },
    );
  },
});
