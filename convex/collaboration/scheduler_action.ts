"use node";

import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { callOpenRouterNonStreaming } from "../lib/openrouter";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  isZdrEnabled,
  selectAncillaryModelForZdr,
  withZdrProvider,
} from "../lib/openrouter_zdr";
import { MODEL_IDS } from "../lib/model_constants";
import { usageObject } from "../schema_validators";
import {
  buildSchedulerPrompt,
  deterministicSchedulerDecision,
  parseSchedulerDecisionOrSilence,
  type SchedulerPolicyInput,
} from "./scheduler_policy";
import { schedulerResponseFormat } from "./scheduler_response_format";
import {
  COLLABORATION_SCHEDULER_MODEL,
  COLLABORATION_SCHEDULER_VERSION,
} from "./constants";
import { collaborationSelection } from "./validators";

export const decideSpeakers = internalAction({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    wave: v.number(),
  },
  returns: v.object({
    selections: v.array(collaborationSelection),
    excludedParticipantIds: v.array(v.id("chatParticipants")),
    diagnosticCategory: v.string(),
    schedulerVersion: v.string(),
    schedulerModelId: v.optional(v.string()),
    generationId: v.optional(v.string()),
    usage: v.optional(usageObject),
  }),
  handler: async (ctx, args) => {
    const input = await ctx.runQuery(
      internal.collaboration.scheduler_context.getSchedulerContext,
      args,
    ) as SchedulerPolicyInput & { userId: string } | null;
    if (!input) throw new Error("COLLABORATION_SCHEDULER_STALE_CONTEXT");
    const deterministic = deterministicSchedulerDecision(input);
    if (deterministic) {
      return {
        ...deterministic,
        schedulerVersion: COLLABORATION_SCHEDULER_VERSION,
      };
    }
    const [apiKey, preferences] = await Promise.all([
      getRequiredUserOpenRouterApiKey(ctx, input.userId),
      ctx.runQuery(internal.chat.queries.getUserPreferences, {
        userId: input.userId,
      }),
    ]);
    const requireZdr = isZdrEnabled(preferences);
    const modelId = selectAncillaryModelForZdr({
      requestedModel: COLLABORATION_SCHEDULER_MODEL,
      defaultModel: MODEL_IDS.appDefault,
      requireZdr,
    });
    const result = await callOpenRouterNonStreaming(
      apiKey,
      modelId,
      [
        {
          role: "system",
          content: "Make a bounded scheduling decision. Return only the requested JSON; never include hidden reasoning.",
        },
        { role: "user", content: buildSchedulerPrompt(input) },
      ],
      withZdrProvider({
        temperature: 0.1,
        maxTokens: 1_200,
        includeReasoning: false,
        reasoningEffort: "minimal",
        responseFormat: schedulerResponseFormat(input),
      }, requireZdr),
      { fallbackModel: MODEL_IDS.autonomousFallback },
    );
    const decision = parseSchedulerDecisionOrSilence(
      result.content,
      input,
      result.finishReason,
    );
    if (decision.diagnosticCategory.startsWith("scheduler_")) {
      console.warn("[collaboration:scheduler] invalid structured response", {
        exchangeId: args.exchangeId,
        wave: args.wave,
        modelId: result.modelId ?? modelId,
        finishReason: result.finishReason,
        contentLength: result.content.length,
      });
    }
    return {
      ...decision,
      schedulerVersion: COLLABORATION_SCHEDULER_VERSION,
      schedulerModelId: result.modelId ?? modelId,
      generationId: result.generationId ?? undefined,
      usage: result.usage ?? undefined,
    };
  },
});
