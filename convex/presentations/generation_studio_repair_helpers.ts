"use node";

import type { ActionCtx } from "../_generated/server";
import {
  completePresentationStudioBatchRef,
  queuePresentationStudioRepairRef,
  type PresentationStudioContext,
} from "./generation_fanout_refs";
import { applyDeterministicPresentationLayoutRepairs } from "./generation_layout_repair";
import { MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS, safePresentationErrorMessage } from "./limits";
import { PresentationDeckSlideLayoutError, parsePresentationDeck } from "./model_parsing";
import {
  deletePresentationRepairCandidate,
  storePresentationRepairCandidate,
} from "./repair_candidate_storage";
import type { ParsedPresentationSlide } from "./types";
import { presentationExecutionIdentity } from "./generation_execution_identity";

export type StudioAttemptOutcome = {
  handled: boolean;
  validationError?: string;
  targetSlideId?: string;
};

export function exhaustedRepairError(outcome: StudioAttemptOutcome): Error {
  const slide = outcome.targetSlideId ? ` on slide '${outcome.targetSlideId}'` : "";
  const detail = outcome.validationError
    ? ` Last validation issue: ${outcome.validationError}`
    : "";
  return new Error(`Presentation studio exhausted its repair attempts${slide}.${detail}`);
}

export async function queueStudioRepair(args: {
  ctx: ActionCtx;
  context: PresentationStudioContext;
  candidateContent?: string;
  targetSlideId?: string;
  validationError: string;
  validationCode?: string;
  validationDetails?: string;
  effectiveModelId?: string;
}): Promise<boolean> {
  const attempt = args.context.batch.repairAttempt + 1;
  if (attempt > MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS) return false;
  const candidateStorageId = args.candidateContent
    ? await storePresentationRepairCandidate(args.ctx, args.candidateContent, {
      scheduleLegacyCleanup: !args.context.project.workflowId,
    })
    : undefined;
  try {
    const queued = await args.ctx.runMutation(queuePresentationStudioRepairRef, {
      runId: args.context.run._id,
      batchId: args.context.batch._id,
      ...presentationExecutionIdentity(args.context.run),
      repairAttempt: attempt,
      ...(candidateStorageId ? { candidateStorageId } : {}),
      ...(args.targetSlideId ? { targetSlideId: args.targetSlideId } : {}),
      validationError: args.validationError.slice(0, 500),
      ...(args.validationCode ? { validationCode: args.validationCode } : {}),
      ...(args.validationDetails ? { validationDetails: args.validationDetails } : {}),
      ...(args.effectiveModelId ? { effectiveModelId: args.effectiveModelId } : {}),
    });
    if (!queued) await deletePresentationRepairCandidate(args.ctx, candidateStorageId);
    return queued;
  } catch (error) {
    await deletePresentationRepairCandidate(args.ctx, candidateStorageId);
    throw error;
  }
}

export async function completeStudioDeck(
  ctx: ActionCtx,
  context: PresentationStudioContext,
  slides: ParsedPresentationSlide[],
  effectiveModelId: string,
  allowLayoutIssues = false,
): Promise<void> {
  await ctx.runMutation(completePresentationStudioBatchRef, {
    runId: context.run._id,
    batchId: context.batch._id,
    ...presentationExecutionIdentity(context.run),
    slides,
    effectiveModelId,
    ...(allowLayoutIssues ? { allowLayoutIssues: true } : {}),
  });
}

export async function completeOrQueueStudioRepair(args: {
  ctx: ActionCtx;
  context: PresentationStudioContext;
  content: string;
  effectiveModelId: string;
}): Promise<StudioAttemptOutcome> {
  const batchIds = new Set(args.context.batch.slideIds);
  const batchPlan = (args.context.project.plan ?? []).filter((slide) => batchIds.has(slide.id));
  try {
    const deck = parsePresentationDeck(
      args.content,
      batchPlan,
      args.context.project.imageMode,
      (args.context.project.assetStorageIds ?? []).map(String),
      false,
    );
    await completeStudioDeck(args.ctx, args.context, deck.slides, args.effectiveModelId);
    return { handled: true };
  } catch (error) {
    const layoutError = error instanceof PresentationDeckSlideLayoutError ? error : undefined;
    const deterministic = layoutError
      ? applyDeterministicPresentationLayoutRepairs({
          candidateContent: args.content,
          layoutError,
          plan: batchPlan,
          imageMode: args.context.project.imageMode,
          allowedAssetStorageIds: (args.context.project.assetStorageIds ?? []).map(String),
          requireReferenceAsset: false,
        })
      : null;
    if (deterministic?.deck) {
      await completeStudioDeck(
        args.ctx,
        args.context,
        deterministic.deck.slides,
        args.effectiveModelId,
      );
      return { handled: true };
    }
    const remainingLayoutError = deterministic?.layoutError ?? layoutError;
    const validationError = safePresentationErrorMessage(remainingLayoutError ?? error);
    const targetSlideId = remainingLayoutError?.slideId;
    const queued = await queueStudioRepair({
      ...args,
      candidateContent: deterministic?.candidateContent ?? args.content,
      targetSlideId,
      validationError,
      validationCode: remainingLayoutError?.issue?.code,
      validationDetails: remainingLayoutError?.issues
        ? JSON.stringify(remainingLayoutError.issues)
        : undefined,
    });
    if (queued || !remainingLayoutError) {
      return { handled: queued, validationError, targetSlideId };
    }
    const releasable = parsePresentationDeck(
      deterministic?.candidateContent ?? args.content,
      batchPlan,
      args.context.project.imageMode,
      (args.context.project.assetStorageIds ?? []).map(String),
      false,
      "release",
    );
    await completeStudioDeck(
      args.ctx,
      args.context,
      releasable.slides,
      args.effectiveModelId,
      true,
    );
    return { handled: true, validationError, targetSlideId };
  }
}
