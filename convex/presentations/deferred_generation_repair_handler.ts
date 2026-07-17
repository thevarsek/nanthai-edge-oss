"use node";

import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import {
  completeGenerationRef,
  getProjectInternalRef,
  setWorkflowPhaseRef,
} from "./action_refs";
import { resolvePresentationAiAccess } from "./action_shared";
import { loadPresentationPromptAssets } from "./asset_inputs";
import { schedulePhase, workflowIsActive } from "./deferred_workflow_actions";
import type { DeferredPresentationRepairArgs } from "./deferred_workflow_refs";
import {
  presentationWorkflowArgs,
  runDeferredPresentationGenerateRepairRef,
  runDeferredPresentationSnapshotRef,
} from "./deferred_workflow_refs";
import {
  markPresentationFailedAndResume,
  presentationRepairDeps,
} from "./deferred_workflow_repair_shared";
import {
  PresentationLayoutRepairContinuationError,
  applyPresentationLayoutRepair,
  presentationSlideRepairTarget,
} from "./generation_layout_repair";
import {
  MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS,
  PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
  safePresentationErrorMessage,
} from "./limits";
import {
  PresentationDeckSlideLayoutError,
  parsePresentationDeck,
} from "./model_parsing";
import {
  buildGenerationLayoutRepairMessages,
  buildGenerationRepairMessages,
} from "./prompts";
import {
  deletePresentationRepairCandidate,
  storePresentationRepairCandidate,
} from "./repair_candidate_storage";

function repairAttempt(args: DeferredPresentationRepairArgs): number {
  return Number.isSafeInteger(args.repairAttempt) && (args.repairAttempt ?? 0) > 0
    ? args.repairAttempt ?? 1
    : 1;
}

function isInvalidModelResponse(error: unknown): boolean {
  return error instanceof ConvexError &&
    (error.data as { code?: string } | undefined)?.code === "MODEL_RESPONSE_INVALID";
}

async function scheduleLayoutRepair(
  ctx: ActionCtx,
  args: DeferredPresentationRepairArgs,
  candidateContent: string,
  targetSlideId: string,
  validationError: string,
): Promise<boolean> {
  const attempt = repairAttempt(args);
  if (attempt >= MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS) return false;
  const project = await ctx.runQuery(getProjectInternalRef, {
    projectId: args.projectId,
    userId: args.userId,
  });
  if (!project || project.status !== "generating") return false;
  const renewed = await ctx.runMutation(setWorkflowPhaseRef, {
    projectId: project._id,
    userId: args.userId,
    expectedRevision: project.revision,
    phase: "repairing_generation",
  });
  if (!renewed) return false;
  const candidateStorageId = await storePresentationRepairCandidate(ctx, candidateContent);
  try {
    const scheduled = await schedulePhase(ctx, {
      ...presentationWorkflowArgs(args),
      invalidResponse: "",
      validationError: validationError.slice(0, 500),
      candidateStorageId,
      targetSlideId,
      repairAttempt: attempt + 1,
    }, runDeferredPresentationGenerateRepairRef);
    if (!scheduled) await deletePresentationRepairCandidate(ctx, candidateStorageId);
    return scheduled;
  } catch (error) {
    await deletePresentationRepairCandidate(ctx, candidateStorageId);
    throw error;
  }
}

export async function runDeferredPresentationGenerateRepairHandler(
  ctx: ActionCtx,
  args: DeferredPresentationRepairArgs,
): Promise<void> {
  let candidateContent: string | undefined;
  try {
    if (!(await workflowIsActive(ctx, args.jobId))) return;
    const project = await ctx.runQuery(getProjectInternalRef, {
      projectId: args.projectId,
      userId: args.userId,
    });
    if (!project || project.status !== "generating" || !project.plan?.length) {
      throw new Error("Presentation generation repair is no longer current.");
    }
    const deps = presentationRepairDeps(args.userId);
    const ai = await resolvePresentationAiAccess(
      ctx,
      args.userId,
      args.modelId,
      args.requireZdrOverride,
      deps,
    );
    const assets = await loadPresentationPromptAssets(ctx, project);
    const allowedAssetStorageIds = (project.assetStorageIds ?? []).map(String);
    let parsed;
    if (args.candidateStorageId && args.targetSlideId) {
      const blob = await ctx.storage.get(args.candidateStorageId);
      if (!blob) throw new Error("The private slide repair candidate expired.");
      candidateContent = await blob.text();
      const slide = presentationSlideRepairTarget(candidateContent, project.plan, args.targetSlideId);
      const planSlide = project.plan.find((entry) => entry.id === args.targetSlideId);
      if (!planSlide) throw new Error("The planned slide repair target was not found.");
      const response = await deps.callOpenRouterNonStreaming(
        ai.apiKey,
        ai.modelId,
        buildGenerationLayoutRepairMessages({
          title: project.title,
          prompt: project.prompt,
          direction: project.direction,
          imageMode: project.imageMode,
          planSlide,
          slide,
          validationError: args.validationError,
          assets,
        }),
        withZdrProvider({
          temperature: 0.1,
          includeReasoning: false,
        }, ai.requireZdr),
        {
          fallbackModel: MODEL_IDS.appDefault,
          requestTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
          totalTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
        },
      );
      try {
        parsed = applyPresentationLayoutRepair({
          candidateContent,
          repairContent: response.content,
          targetSlideId: args.targetSlideId,
          plan: project.plan,
          imageMode: project.imageMode,
          allowedAssetStorageIds,
        }).deck;
      } catch (error) {
        if (error instanceof PresentationLayoutRepairContinuationError) {
          if (await scheduleLayoutRepair(
            ctx,
            args,
            error.candidateContent,
            error.layoutError.slideId,
            error.layoutError.message,
          )) return;
          throw error.layoutError;
        }
        throw error;
      }
    } else {
      const response = await deps.callOpenRouterNonStreaming(
        ai.apiKey,
        ai.modelId,
        buildGenerationRepairMessages({
          title: project.title,
          prompt: project.prompt,
          direction: project.direction,
          imageMode: project.imageMode,
          plan: project.plan,
          creativeDirection: project.creativeDirection,
          invalidResponse: args.invalidResponse,
          validationError: args.validationError,
          assets,
        }),
        withZdrProvider({
          temperature: 0.1,
          includeReasoning: false,
        }, ai.requireZdr),
        {
          fallbackModel: MODEL_IDS.appDefault,
          requestTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
          totalTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
        },
      );
      try {
        parsed = parsePresentationDeck(
          response.content,
          project.plan,
          project.imageMode,
          allowedAssetStorageIds,
        );
      } catch (error) {
        if (
          error instanceof PresentationDeckSlideLayoutError &&
          await scheduleLayoutRepair(ctx, args, response.content, error.slideId, error.message)
        ) return;
        throw error;
      }
    }
    await ctx.runMutation(completeGenerationRef, {
      projectId: project._id,
      userId: args.userId,
      expectedRevision: project.revision,
      slides: parsed.slides,
    });
    await schedulePhase(ctx, presentationWorkflowArgs(args), runDeferredPresentationSnapshotRef);
  } catch (error) {
    if (
      candidateContent &&
      args.targetSlideId &&
      isInvalidModelResponse(error) &&
      await scheduleLayoutRepair(
        ctx,
        args,
        candidateContent,
        args.targetSlideId,
        `${args.validationError} Previous patch failed: ${safePresentationErrorMessage(error)}`,
      )
    ) return;
    await markPresentationFailedAndResume(ctx, args, error);
  } finally {
    await deletePresentationRepairCandidate(ctx, args.candidateStorageId);
  }
}
