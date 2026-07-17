"use node";

import type { ActionCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import { createPresentationActionDepsForTest, resolvePresentationAiAccess } from "./action_shared";
import { loadPresentationPromptAssets } from "./asset_inputs";
import type { PresentationStudioContext } from "./generation_fanout_refs";
import { PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS } from "./limits";
import { buildStudioGenerationMessages } from "./studio_prompts";

export async function callPresentationStudio(
  ctx: ActionCtx,
  context: PresentationStudioContext,
) {
  const deps = createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: context.run.userId }),
  });
  const ai = await resolvePresentationAiAccess(
    ctx,
    context.run.userId,
    context.run.selectedModelId,
    context.run.requireZdrOverride,
    deps,
  );
  const assets = await loadPresentationPromptAssets(ctx, context.project);
  const response = await deps.callOpenRouterNonStreaming(
    ai.apiKey,
    ai.modelId,
    buildStudioGenerationMessages({
      title: context.project.title,
      prompt: context.project.prompt,
      direction: context.project.direction,
      imageMode: context.project.imageMode,
      plan: context.project.plan ?? [],
      targetSlideIds: context.batch.slideIds,
      creativeDirection: context.project.creativeDirection,
      assets,
    }),
    withZdrProvider({ temperature: 0.72, includeReasoning: false }, ai.requireZdr),
    {
      fallbackModel: MODEL_IDS.appDefault,
      requestTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
      totalTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
    },
  );
  return { response, ai };
}
