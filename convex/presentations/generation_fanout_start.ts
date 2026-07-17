import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { expireWorkflowRef } from "./action_refs";
import { buildPresentationStudioBatches } from "./generation_fanout";
import { runPresentationStudioRef } from "./generation_fanout_refs";
import { PRESENTATION_WORKFLOW_LEASE_MS, presentationError } from "./limits";
import { getOwnedProject, throwRevisionConflict } from "./mutation_helpers";

export async function renewPresentationFanoutLease(
  ctx: MutationCtx,
  runId: Id<"presentationGenerationRuns">,
): Promise<number> {
  const run = await ctx.db.get(runId);
  if (!run) throw presentationError("NOT_FOUND", "Presentation generation run not found.");
  const project = await ctx.db.get(run.projectId);
  if (!project || project.userId !== run.userId || project.status !== "generating") {
    throw presentationError("INVALID_STATE", "Presentation generation is no longer current.");
  }
  const projectRevision = project.revision + 1;
  const now = Date.now();
  await ctx.db.patch(project._id, { revision: projectRevision, updatedAt: now });
  await ctx.db.patch(run._id, { projectRevision, updatedAt: now });
  await ctx.scheduler.runAfter(PRESENTATION_WORKFLOW_LEASE_MS, expireWorkflowRef, {
    projectId: project._id,
    userId: run.userId,
    expectedRevision: projectRevision,
  });
  return projectRevision;
}

export async function startPresentationFanoutHandler(ctx: MutationCtx, args: {
  projectId: Id<"presentationProjects">;
  userId: string;
  jobId: Id<"generationJobs">;
  toolCallId: string;
  expectedRevision: number;
  modelId: string;
  requireZdrOverride?: boolean;
}) {
  const project = await getOwnedProject(ctx, args.projectId, args.userId);
  if (project.status === "generating") {
    const existing = await ctx.db.query("presentationGenerationRuns")
      .withIndex("by_project_revision", (query) =>
        query.eq("projectId", project._id).eq("projectRevision", project.revision)
      ).first();
    if (existing) return { runId: existing._id, started: false };
  }
  if (project.status !== "planned" || !project.plan?.length) {
    throw presentationError("INVALID_STATE", "Plan this presentation before generating slides.");
  }
  if (project.revision !== args.expectedRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const batches = buildPresentationStudioBatches(project.plan);
  const now = Date.now();
  const projectRevision = project.revision + 1;
  await ctx.db.patch(project._id, {
    status: "generating",
    workflowPhase: "generating",
    modelId: args.modelId,
    error: undefined,
    revision: projectRevision,
    updatedAt: now,
  });
  const runId = await ctx.db.insert("presentationGenerationRuns", {
    userId: args.userId,
    projectId: project._id,
    projectRevision,
    jobId: args.jobId,
    toolCallId: args.toolCallId,
    selectedModelId: args.modelId,
    ...(args.requireZdrOverride !== undefined
      ? { requireZdrOverride: args.requireZdrOverride }
      : {}),
    expectedSlideIds: project.plan.map((slide) => slide.id),
    completedSlideIds: [],
    deletedSlideIds: [],
    studioCount: batches.length,
    status: "generating",
    createdAt: now,
    updatedAt: now,
  });
  for (const batch of batches) {
    const batchId = await ctx.db.insert("presentationGenerationBatches", {
      runId,
      userId: args.userId,
      batchIndex: batch.batchIndex,
      slideIds: batch.slideIds,
      status: "queued",
      repairAttempt: 0,
      effectiveModelIds: [],
      createdAt: now,
      updatedAt: now,
    });
    const scheduledFunctionId = await ctx.scheduler.runAfter(0, runPresentationStudioRef, {
      runId,
      batchId,
    });
    await ctx.db.patch(batchId, { scheduledFunctionId });
  }
  await ctx.scheduler.runAfter(PRESENTATION_WORKFLOW_LEASE_MS, expireWorkflowRef, {
    projectId: project._id,
    userId: args.userId,
    expectedRevision: projectRevision,
  });
  return { runId, started: true };
}
