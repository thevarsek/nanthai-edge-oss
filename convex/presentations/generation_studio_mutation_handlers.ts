import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { validateGeneratedSlideLayout } from "./generated_layout_validation";
import {
  runPresentationCuratorRef,
  runPresentationStudioRepairRef,
} from "./generation_fanout_refs";
import { failPresentationRunState } from "./generation_fanout_cleanup";
import { renewPresentationFanoutLease } from "./generation_fanout_start";
import { inspectSlideHtml } from "./html_contract";
import { MAX_TITLE_CHARS, presentationError, requireBoundedText } from "./limits";
import { harmonizePresentationTypography } from "./typography_harmonization";
import type { ParsedPresentationSlide } from "./types";

function appendModel(models: string[], modelId: string | undefined): string[] {
  return modelId ? [...new Set([...models, modelId])] : models;
}

export async function claimPresentationStudioBatchHandler(ctx: MutationCtx, args: {
  runId: Id<"presentationGenerationRuns">;
  batchId: Id<"presentationGenerationBatches">;
  repair: boolean;
}): Promise<boolean> {
  const [run, batch] = await Promise.all([ctx.db.get(args.runId), ctx.db.get(args.batchId)]);
  const expectedStatus = args.repair ? "repairing" : "queued";
  if (!run || run.status !== "generating" || !batch || batch.runId !== run._id ||
      batch.status !== expectedStatus) return false;
  const project = await ctx.db.get(run.projectId);
  if (!project || project.status !== "generating" || project.revision !== run.projectRevision) {
    return false;
  }
  await ctx.db.patch(batch._id, {
    status: "running",
    startedAt: batch.startedAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  return true;
}

export async function queuePresentationStudioRepairHandler(ctx: MutationCtx, args: {
  runId: Id<"presentationGenerationRuns">;
  batchId: Id<"presentationGenerationBatches">;
  repairAttempt: number;
  candidateStorageId?: Id<"_storage">;
  targetSlideId?: string;
  validationError: string;
  validationCode?: string;
  validationDetails?: string;
  effectiveModelId?: string;
}): Promise<boolean> {
  const [run, batch] = await Promise.all([ctx.db.get(args.runId), ctx.db.get(args.batchId)]);
  if (!run || run.status !== "generating" || !batch || batch.runId !== run._id ||
      batch.status !== "running") return false;
  const scheduledFunctionId = await ctx.scheduler.runAfter(0, runPresentationStudioRepairRef, {
    runId: run._id,
    batchId: batch._id,
  });
  await ctx.db.patch(batch._id, {
    status: "repairing",
    repairAttempt: args.repairAttempt,
    candidateStorageId: args.candidateStorageId ?? batch.candidateStorageId,
    targetSlideId: args.targetSlideId,
    validationError: args.validationError.slice(0, 500),
    validationDetails: args.validationDetails?.slice(0, 1_500),
    validationHistory: [
      ...(batch.validationHistory ?? []),
      {
        attempt: args.repairAttempt,
        ...(args.targetSlideId ? { slideId: args.targetSlideId } : {}),
        ...(args.validationCode ? { code: args.validationCode } : {}),
        message: args.validationError.slice(0, 500),
        ...(args.validationDetails
          ? { details: args.validationDetails.slice(0, 1_500) }
          : {}),
      },
    ].slice(-8),
    effectiveModelIds: appendModel(batch.effectiveModelIds, args.effectiveModelId),
    scheduledFunctionId,
    updatedAt: Date.now(),
  });
  await renewPresentationFanoutLease(ctx, run._id);
  return true;
}

export async function completePresentationStudioBatchHandler(ctx: MutationCtx, args: {
  runId: Id<"presentationGenerationRuns">;
  batchId: Id<"presentationGenerationBatches">;
  slides: ParsedPresentationSlide[];
  effectiveModelId: string;
  allowLayoutIssues?: boolean;
}) {
  const [run, batch] = await Promise.all([ctx.db.get(args.runId), ctx.db.get(args.batchId)]);
  if (!run || run.status !== "generating" || !batch || batch.runId !== run._id ||
      batch.status !== "running") return { accepted: false, curatorQueued: false };
  if (args.slides.length !== batch.slideIds.length ||
      args.slides.some((slide, index) => slide.id !== batch.slideIds[index])) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Studio slides did not match the assigned slide IDs.");
  }
  const project = await ctx.db.get(run.projectId);
  if (!project || project.status !== "generating" || project.revision !== run.projectRevision) {
    return { accepted: false, curatorQueued: false };
  }
  const planPositions = new Map((project.plan ?? []).map((slide, index) => [slide.id, index]));
  const now = Date.now();
  for (const slide of args.slides) {
    const position = planPositions.get(slide.id);
    if (position === undefined) {
      throw presentationError("MODEL_RESPONSE_INVALID", "Studio returned an unexpected slide ID.");
    }
    const inspected = inspectSlideHtml(slide.html, project.assetStorageIds ?? []);
    const harmonizedHtml = harmonizePresentationTypography(
      inspected.html,
      project.creativeDirection?.typographyRoles,
    );
    const normalized = harmonizedHtml === inspected.html
      ? inspected
      : inspectSlideHtml(harmonizedHtml, project.assetStorageIds ?? []);
    if (!args.allowLayoutIssues) validateGeneratedSlideLayout(normalized.html);
    await ctx.db.insert("presentationSlideCandidates", {
      runId: run._id,
      userId: run.userId,
      slideId: slide.id,
      position,
      title: requireBoundedText(slide.title, "Slide title", MAX_TITLE_CHARS),
      notes: slide.notes?.trim() || undefined,
      html: normalized.html,
      effectiveModelId: args.effectiveModelId,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(batch._id, {
    status: "complete",
    effectiveModelIds: appendModel(batch.effectiveModelIds, args.effectiveModelId),
    candidateStorageId: undefined,
    targetSlideId: undefined,
    validationError: undefined,
    completedAt: now,
    updatedAt: now,
  });
  const completedSlideIds = [...new Set([...run.completedSlideIds, ...batch.slideIds])];
  const exact = completedSlideIds.length === run.expectedSlideIds.length &&
    run.expectedSlideIds.every((slideId) => completedSlideIds.includes(slideId));
  if (!exact) {
    await ctx.db.patch(run._id, { completedSlideIds, updatedAt: now });
    return { accepted: true, curatorQueued: false };
  }
  const curatorScheduledFunctionId = await ctx.scheduler.runAfter(0, runPresentationCuratorRef, {
    runId: run._id,
  });
  await ctx.db.patch(run._id, {
    completedSlideIds,
    status: "curator_queued",
    curatorScheduledFunctionId,
    updatedAt: now,
  });
  await renewPresentationFanoutLease(ctx, run._id);
  return { accepted: true, curatorQueued: true };
}

export async function failPresentationFanoutHandler(ctx: MutationCtx, args: {
  runId: Id<"presentationGenerationRuns">;
  batchId?: Id<"presentationGenerationBatches">;
  error: string;
}): Promise<boolean> {
  const run = await ctx.db.get(args.runId);
  if (!run || run.status === "complete" || run.status === "failed") return false;
  const project = await ctx.db.get(run.projectId);
  const now = Date.now();
  await failPresentationRunState(ctx, run, args.error, now);
  if (project?.status === "generating" && project.revision === run.projectRevision) {
    await ctx.db.patch(project._id, {
      status: "failed",
      workflowPhase: "failed",
      error: args.error.slice(0, 500),
      revision: project.revision + 1,
      updatedAt: now,
    });
  }
  return true;
}
