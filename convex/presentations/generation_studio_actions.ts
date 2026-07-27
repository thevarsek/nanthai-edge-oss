"use node";

import { internalAction, type ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import { createPresentationActionDepsForTest, resolvePresentationAiAccess } from "./action_shared";
import { loadPresentationPromptAssets } from "./asset_inputs";
import {
  PresentationLayoutRepairContinuationError,
  applyDeterministicPresentationLayoutRepairs,
  applyPresentationLayoutRepair,
  presentationSlideRepairTarget,
} from "./generation_layout_repair";
import { layoutRepairElementIds } from "./generation_layout_repair_targets";
import {
  claimPresentationStudioBatchRef,
  completePresentationStudioBatchRef,
  failPresentationFanoutRef,
} from "./generation_fanout_refs";
import { presentationGenerationJobIsActive } from "./generation_workflow_active";
import {
  PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
  safePresentationErrorMessage,
} from "./limits";
import { parsePresentationDeck } from "./model_parsing";
import {
  buildGenerationLayoutRepairMessages,
  buildGenerationRepairMessages,
} from "./prompts";
import {
  deletePresentationRepairCandidate,
} from "./repair_candidate_storage";
import { buildStudioGenerationMessages } from "./studio_prompts";
import { callPresentationStudio } from "./generation_studio_model";
import {
  completeOrQueueStudioRepair,
  completeStudioDeck,
  exhaustedRepairError,
  queueStudioRepair,
  type StudioAttemptOutcome,
} from "./generation_studio_repair_helpers";
import { presentationExecutionIdentity } from "./generation_execution_identity";
import {
  presentationStudioActionContext as studioContext,
} from "./generation_studio_action_context";

const studioArgs = {
  runId: v.id("presentationGenerationRuns"),
  batchId: v.id("presentationGenerationBatches"),
  executionAttemptId: v.id("executionAttempts"),
  executionFence: v.number(),
};

async function failStudio(
  ctx: ActionCtx,
  context: NonNullable<Awaited<ReturnType<typeof studioContext>>>,
  error: unknown,
): Promise<void> {
  const message = safePresentationErrorMessage(error);
  await ctx.runMutation(failPresentationFanoutRef, {
    runId: context.run._id,
    batchId: context.batch._id,
    ...presentationExecutionIdentity(context.run),
    error: message,
  });
}

export const runPresentationStudio = internalAction({
  args: studioArgs,
  handler: async (ctx, args): Promise<void> => {
    const context = await studioContext(ctx, args);
    if (!context) return;
    if (!(await presentationGenerationJobIsActive(ctx, context.run.jobId))) return;
    if (!(await ctx.runMutation(claimPresentationStudioBatchRef, {
      runId: context.run._id,
      batchId: context.batch._id,
      ...presentationExecutionIdentity(context.run),
      repair: false,
    }))) return;
    try {
      const { response, ai } = await callPresentationStudio(ctx, context);
      const outcome = await completeOrQueueStudioRepair({
        ctx,
        context,
        content: response.content,
        effectiveModelId: response.modelId ?? ai.modelId,
      });
      if (!outcome.handled) await failStudio(ctx, context, exhaustedRepairError(outcome));
    } catch (error) {
      if (await queueStudioRepair({ ctx, context, validationError: safePresentationErrorMessage(error) })) return;
      await failStudio(ctx, context, error);
    }
  },
});

export const runPresentationStudioRepair = internalAction({
  args: studioArgs,
  handler: async (ctx, args): Promise<void> => {
    const context = await studioContext(ctx, args);
    if (!context) return;
    if (!(await presentationGenerationJobIsActive(ctx, context.run.jobId))) return;
    if (!(await ctx.runMutation(claimPresentationStudioBatchRef, {
      runId: context.run._id,
      batchId: context.batch._id,
      ...presentationExecutionIdentity(context.run),
      repair: true,
    }))) return;
    let oldCandidate: typeof context.batch.candidateStorageId;
    let deleteOldCandidate = false;
    try {
      oldCandidate = context.batch.candidateStorageId;
      const { response, ai, assets } = await callStudioRepair(ctx, context);
      const effectiveModelId = response.modelId ?? ai.modelId;
      const outcome = await applyRepairResponse(ctx, context, response.content, effectiveModelId, assets);
      if (outcome.handled) {
        deleteOldCandidate = true;
      } else {
        await failStudio(ctx, context, exhaustedRepairError(outcome));
      }
    } catch (error) {
      if (await queueStudioRepair({ ctx, context, validationError: safePresentationErrorMessage(error) })) {
        return;
      }
      await failStudio(ctx, context, error);
    } finally {
      if (deleteOldCandidate) await deletePresentationRepairCandidate(ctx, oldCandidate);
    }
  },
});

async function callStudioRepair(
  ctx: ActionCtx,
  context: NonNullable<Awaited<ReturnType<typeof studioContext>>>,
) {
  const deps = createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: context.run.userId }),
  });
  const ai = await resolvePresentationAiAccess(
    ctx, context.run.userId, context.run.selectedModelId,
    context.run.requireZdrOverride, deps,
  );
  const assets = await loadPresentationPromptAssets(ctx, context.project);
  const batchIds = new Set(context.batch.slideIds);
  const batchPlan = (context.project.plan ?? []).filter((slide) => batchIds.has(slide.id));
  const blob = context.batch.candidateStorageId
    ? await ctx.storage.get(context.batch.candidateStorageId)
    : null;
  const candidateContent = blob ? await blob.text() : undefined;
  let messages = buildStudioGenerationMessages({
    title: context.project.title,
    prompt: context.project.prompt,
    direction: context.project.direction,
    imageMode: context.project.imageMode,
    plan: context.project.plan ?? [],
    targetSlideIds: context.batch.slideIds,
    creativeDirection: context.project.creativeDirection,
    assets,
  });
  if (candidateContent && context.batch.targetSlideId) {
    const planSlide = batchPlan.find((slide) => slide.id === context.batch.targetSlideId);
    if (!planSlide) throw new Error("Studio repair target was not planned.");
    messages = buildGenerationLayoutRepairMessages({
      title: context.project.title,
      prompt: context.project.prompt,
      direction: context.project.direction,
      imageMode: context.project.imageMode,
      planSlide,
      slide: presentationSlideRepairTarget(candidateContent, batchPlan, planSlide.id),
      validationError: [
        context.batch.validationError ?? "Slide layout validation failed.",
        context.batch.validationDetails
          ? `Exact geometry: ${context.batch.validationDetails}`
          : undefined,
      ].filter((value): value is string => value !== undefined).join("\n"),
      assets,
    });
  } else if (candidateContent) {
    messages = buildGenerationRepairMessages({
      title: context.project.title,
      prompt: context.project.prompt,
      direction: context.project.direction,
      imageMode: context.project.imageMode,
      plan: batchPlan,
      creativeDirection: context.project.creativeDirection,
      invalidResponse: candidateContent,
      validationError: context.batch.validationError ?? "Studio output validation failed.",
      assets,
    });
  }
  const response = await deps.callOpenRouterNonStreaming(
    ai.apiKey, ai.modelId, messages,
    withZdrProvider({ temperature: 0.1, includeReasoning: false }, ai.requireZdr),
    {
      fallbackModel: MODEL_IDS.appDefault,
      requestTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
      totalTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
    },
  );
  return { response, ai, assets, candidateContent, batchPlan };
}

async function applyRepairResponse(
  ctx: ActionCtx,
  context: NonNullable<Awaited<ReturnType<typeof studioContext>>>,
  repairContent: string,
  effectiveModelId: string,
  _assets: Awaited<ReturnType<typeof loadPresentationPromptAssets>>,
): Promise<StudioAttemptOutcome> {
  const batchIds = new Set(context.batch.slideIds);
  const batchPlan = (context.project.plan ?? []).filter((slide) => batchIds.has(slide.id));
  const blob = context.batch.candidateStorageId
    ? await ctx.storage.get(context.batch.candidateStorageId)
    : null;
  const candidateContent = blob ? await blob.text() : undefined;
  if (candidateContent && context.batch.targetSlideId) {
    try {
      const deck = applyPresentationLayoutRepair({
        candidateContent,
        repairContent,
        targetSlideId: context.batch.targetSlideId,
        plan: batchPlan,
        imageMode: context.project.imageMode,
        allowedAssetStorageIds: (context.project.assetStorageIds ?? []).map(String),
        requireReferenceAsset: false,
        allowedElementIds: layoutRepairElementIds(context.batch.validationDetails),
      }).deck;
      await ctx.runMutation(completePresentationStudioBatchRef, {
        runId: context.run._id,
        batchId: context.batch._id,
        ...presentationExecutionIdentity(context.run),
        slides: deck.slides,
        effectiveModelId,
      });
      return { handled: true };
    } catch (error) {
      if (error instanceof PresentationLayoutRepairContinuationError) {
        const deterministic = applyDeterministicPresentationLayoutRepairs({
          candidateContent: error.candidateContent,
          layoutError: error.layoutError,
          plan: batchPlan,
          imageMode: context.project.imageMode,
          allowedAssetStorageIds: (context.project.assetStorageIds ?? []).map(String),
          requireReferenceAsset: false,
        });
        if (deterministic?.deck) {
          await completeStudioDeck(ctx, context, deterministic.deck.slides, effectiveModelId);
          return { handled: true };
        }
        const remainingLayoutError = deterministic?.layoutError ?? error.layoutError;
        const validationError = remainingLayoutError.message;
        const targetSlideId = remainingLayoutError.slideId;
        const queued = await queueStudioRepair({
          ctx,
          context,
          candidateContent: deterministic?.candidateContent ?? error.candidateContent,
          targetSlideId,
          validationError,
          validationCode: remainingLayoutError.issue?.code,
          validationDetails: remainingLayoutError.issues
            ? JSON.stringify(remainingLayoutError.issues)
            : undefined,
          effectiveModelId,
        });
        if (queued) return { handled: true, validationError, targetSlideId };
        const releasable = parsePresentationDeck(
          deterministic?.candidateContent ?? error.candidateContent,
          batchPlan,
          context.project.imageMode,
          (context.project.assetStorageIds ?? []).map(String),
          false,
          "release",
        );
        await completeStudioDeck(ctx, context, releasable.slides, effectiveModelId, true);
        return { handled: true, validationError, targetSlideId };
      }
      throw error;
    }
  }
  return await completeOrQueueStudioRepair({
    ctx,
    context,
    content: repairContent,
    effectiveModelId,
  });
}
