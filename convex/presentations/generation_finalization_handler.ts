import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { inspectSlideHtml } from "./html_contract";
import { MAX_TITLE_CHARS, presentationError, requireBoundedText } from "./limits";
import { harmonizePresentationTypography } from "./typography_harmonization";
import { TERMINAL_GENERATION_JOB_STATUSES } from "../chat/generation_continuation_shared";
import { renewPresentationExecutionLease } from "./generation_fanout_start";
import { durableWorkflow } from "../execution/components";
import { isSettledWorkflowSignalError } from
  "../execution/workflow_signal_errors";
import type { WorkflowId } from "@convex-dev/workflow";
import { PRESENTATION_RUN_TERMINAL_EVENT } from "./presentation_workflow_state";
import {
  matchesPresentationExecution,
  type PresentationExecutionIdentity,
} from "./generation_execution_identity";

export async function finalizePresentationFanoutHandler(
  ctx: MutationCtx,
  args: { runId: Id<"presentationGenerationRuns"> } & PresentationExecutionIdentity,
) {
  const run = await ctx.db.get(args.runId);
  if (!run || !matchesPresentationExecution(run, args) || run.status === "complete") return null;
  if (run.status !== "finalizing") {
    throw presentationError("INVALID_STATE", "Presentation curation is not ready to finalize.");
  }
  if (!run.workflowId) {
    throw presentationError(
      "INVALID_STATE",
      "Presentation finalization requires canonical Workflow ownership.",
    );
  }
  const job = await ctx.db.get(run.jobId);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) return null;
  await renewPresentationExecutionLease(ctx, run._id, args);
  const project = await ctx.db.get(run.projectId);
  if (!project || project.userId !== run.userId || project.status !== "generating" ||
      project.revision !== run.projectRevision) {
    throw presentationError("INVALID_STATE", "Presentation finalization is stale.");
  }
  const candidates = (await ctx.db.query("presentationSlideCandidates")
    .withIndex("by_run", (query) => query.eq("runId", run._id)).collect())
    .sort((left, right) => left.position - right.position);
  if (candidates.length !== run.expectedSlideIds.length ||
      candidates.some((candidate, index) => candidate.slideId !== run.expectedSlideIds[index])) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Curated slides do not match the final slide-ID set.");
  }
  const expectedIds = new Set(run.expectedSlideIds);
  const plan = (project.plan ?? []).filter((slide) => expectedIds.has(slide.id));
  if (plan.length !== candidates.length || plan.some((slide, index) => slide.id !== candidates[index]?.slideId)) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Curated slides no longer match the saved plan.");
  }
  const normalized = candidates.map((candidate) => {
    const inspected = inspectSlideHtml(candidate.html, project.assetStorageIds ?? []);
    const harmonizedHtml = harmonizePresentationTypography(
      inspected.html,
      project.creativeDirection?.typographyRoles,
    );
    const normalizedHtml = harmonizedHtml === inspected.html
      ? inspected
      : inspectSlideHtml(harmonizedHtml, project.assetStorageIds ?? []);
    return {
      ...candidate,
      title: requireBoundedText(candidate.title, "Slide title", MAX_TITLE_CHARS),
      html: normalizedHtml,
    };
  });
  if ((project.imageMode === "references" || project.imageMode === "mixed") &&
      (project.assetStorageIds?.length ?? 0) > 0 &&
      !normalized.some((slide) => slide.html.usedAssetStorageIds.size > 0)) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Generated slides omitted every reusable reference asset.");
  }
  const [existing, batches, tasks] = await Promise.all([
    ctx.db.query("presentationSlides")
      .withIndex("by_project", (query) => query.eq("projectId", project._id)).collect(),
    ctx.db.query("presentationGenerationBatches")
      .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
    ctx.db.query("presentationCuratorTasks")
      .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
  ]);
  const now = Date.now();
  await Promise.all(existing.map((slide) => ctx.db.delete(slide._id)));
  for (const [position, candidate] of normalized.entries()) {
    await ctx.db.insert("presentationSlides", {
      userId: run.userId,
      projectId: project._id,
      slideId: candidate.slideId,
      position,
      title: candidate.title,
      notes: candidate.notes,
      html: candidate.html.html,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
  const effectiveModelIds = [...new Set([
    ...(project.effectiveModelIds ?? []),
    ...batches.flatMap((batch) => batch.effectiveModelIds),
    ...tasks.flatMap((task) => task.effectiveModelIds),
  ])];
  const projectRevision = project.revision + 1;
  await ctx.db.patch(project._id, {
    status: "ready",
    workflowPhase: "exporting",
    plan,
    effectiveModelIds,
    modelFallbackUsed: effectiveModelIds.some((modelId) => modelId !== run.selectedModelId),
    error: undefined,
    revision: projectRevision,
    updatedAt: now,
  });
  await ctx.db.patch(run._id, {
    status: "complete",
    projectRevision,
    completedAt: now,
    updatedAt: now,
  });
  try {
    await durableWorkflow.sendEvent(ctx, {
      workflowId: run.workflowId as WorkflowId,
      name: PRESENTATION_RUN_TERMINAL_EVENT,
    });
  } catch (error) {
    if (!isSettledWorkflowSignalError(error)) throw error;
  }
  await Promise.all(candidates.map((candidate) => ctx.db.delete(candidate._id)));
  return {
    projectId: project._id,
    projectRevision,
    slideCount: normalized.length,
  };
}

export async function recoverPresentationFinalizerCompletion(
  ctx: MutationCtx,
  args: {
    runId: Id<"presentationGenerationRuns">;
    operationId: string;
  } & PresentationExecutionIdentity,
): Promise<boolean> {
  const run = await ctx.db.get(args.runId);
  if (!run || run.status === "complete") return true;
  if (run.finalizerWorkpoolOperationId !== args.operationId) return true;
  if (!matchesPresentationExecution(run, args) || run.status !== "finalizing") return false;

  await finalizePresentationFanoutHandler(ctx, args);
  const finalized = await ctx.db.get(args.runId);
  return !finalized || finalized.status === "complete";
}
