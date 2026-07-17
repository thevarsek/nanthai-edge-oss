import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { runDeferredPresentationSnapshotRef } from "./deferred_workflow_refs";
import { inspectSlideHtml } from "./html_contract";
import { MAX_TITLE_CHARS, presentationError, requireBoundedText } from "./limits";
import { harmonizePresentationTypography } from "./typography_harmonization";

export async function finalizePresentationFanoutHandler(
  ctx: MutationCtx,
  args: { runId: Id<"presentationGenerationRuns"> },
) {
  const run = await ctx.db.get(args.runId);
  if (!run || run.status === "complete") return null;
  if (run.status !== "finalizing") {
    throw presentationError("INVALID_STATE", "Presentation curation is not ready to finalize.");
  }
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
  const snapshotScheduledFunctionId = await ctx.scheduler.runAfter(
    0,
    runDeferredPresentationSnapshotRef,
    {
      projectId: project._id,
      userId: run.userId,
      jobId: run.jobId,
      toolCallId: run.toolCallId,
      modelId: run.selectedModelId,
      ...(run.requireZdrOverride !== undefined
        ? { requireZdrOverride: run.requireZdrOverride }
        : {}),
    },
  );
  await ctx.db.patch(run._id, {
    status: "complete",
    projectRevision,
    snapshotScheduledFunctionId,
    completedAt: now,
    updatedAt: now,
  });
  await Promise.all(candidates.map((candidate) => ctx.db.delete(candidate._id)));
  return {
    projectId: project._id,
    projectRevision,
    slideCount: normalized.length,
  };
}
