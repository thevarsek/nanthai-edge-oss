import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { consolidationPreservesContent } from "./curation_analysis";
import {
  runPresentationCuratorTaskRef,
  runPresentationFinalizerRef,
} from "./generation_fanout_refs";
import { renewPresentationFanoutLease } from "./generation_fanout_start";
import { inspectSlideHtml } from "./html_contract";
import { MAX_TITLE_CHARS, presentationError, requireBoundedText } from "./limits";
import { harmonizePresentationTypography } from "./typography_harmonization";
import type { ParsedPresentationSlide } from "./types";

function appendModel(models: string[], modelId: string | undefined): string[] {
  return modelId ? [...new Set([...models, modelId])] : models;
}

async function queueFinalizer(
  ctx: MutationCtx,
  runId: Id<"presentationGenerationRuns">,
): Promise<void> {
  const finalizerScheduledFunctionId = await ctx.scheduler.runAfter(
    0,
    runPresentationFinalizerRef,
    { runId },
  );
  await ctx.db.patch(runId, {
    status: "finalizing",
    finalizerScheduledFunctionId,
    updatedAt: Date.now(),
  });
  await renewPresentationFanoutLease(ctx, runId);
}

export async function claimPresentationCuratorHandler(
  ctx: MutationCtx,
  args: { runId: Id<"presentationGenerationRuns"> },
): Promise<boolean> {
  const run = await ctx.db.get(args.runId);
  if (!run || run.status !== "curator_queued") return false;
  await ctx.db.patch(run._id, { status: "curating", updatedAt: Date.now() });
  await renewPresentationFanoutLease(ctx, run._id);
  return true;
}

export async function startPresentationCuratorTasksHandler(ctx: MutationCtx, args: {
  runId: Id<"presentationGenerationRuns">;
  tasks: Array<{
    taskKey: string;
    kind: "recompose" | "consolidate";
    slideIds: string[];
  }>;
}) {
  const run = await ctx.db.get(args.runId);
  if (!run || run.status !== "curating") return { started: false, taskCount: 0 };
  const existing = await ctx.db.query("presentationCuratorTasks")
    .withIndex("by_run", (query) => query.eq("runId", run._id)).collect();
  if (existing.length > 0) return { started: false, taskCount: existing.length };
  if (args.tasks.length === 0) {
    await queueFinalizer(ctx, run._id);
    return { started: true, taskCount: 0 };
  }
  const seenKeys = new Set<string>();
  const ownedSlides = new Set<string>();
  for (const task of args.tasks) {
    if (!task.taskKey || seenKeys.has(task.taskKey) || task.slideIds.length === 0) {
      throw presentationError("VALIDATION", "Curator tasks must have unique keys and slide targets.");
    }
    if (task.slideIds.some((slideId) =>
      !run.expectedSlideIds.includes(slideId) || ownedSlides.has(slideId)
    )) {
      throw presentationError("VALIDATION", "Curator tasks must own disjoint expected slides.");
    }
    seenKeys.add(task.taskKey);
    task.slideIds.forEach((slideId) => ownedSlides.add(slideId));
  }
  const now = Date.now();
  for (const task of args.tasks) {
    const taskId = await ctx.db.insert("presentationCuratorTasks", {
      runId: run._id,
      userId: run.userId,
      taskKey: task.taskKey,
      kind: task.kind,
      slideIds: task.slideIds,
      status: "queued",
      mode: "patch",
      attempt: 0,
      effectiveModelIds: [],
      createdAt: now,
      updatedAt: now,
    });
    const scheduledFunctionId = await ctx.scheduler.runAfter(
      0,
      runPresentationCuratorTaskRef,
      { taskId },
    );
    await ctx.db.patch(taskId, { scheduledFunctionId });
  }
  return { started: true, taskCount: args.tasks.length };
}

export async function claimPresentationCuratorTaskHandler(ctx: MutationCtx, args: {
  taskId: Id<"presentationCuratorTasks">;
}): Promise<boolean> {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.status !== "queued") return false;
  const run = await ctx.db.get(task.runId);
  if (!run || run.status !== "curating") return false;
  const project = await ctx.db.get(run.projectId);
  if (!project || project.status !== "generating" || project.revision !== run.projectRevision) {
    return false;
  }
  await ctx.db.patch(task._id, { status: "running", updatedAt: Date.now() });
  return true;
}

export async function retryPresentationCuratorTaskHandler(ctx: MutationCtx, args: {
  taskId: Id<"presentationCuratorTasks">;
  mode: "patch" | "recreate";
  attempt: number;
  error: string;
  effectiveModelId?: string;
}): Promise<boolean> {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.status !== "running") return false;
  const run = await ctx.db.get(task.runId);
  if (!run || run.status !== "curating") return false;
  const scheduledFunctionId = await ctx.scheduler.runAfter(
    0,
    runPresentationCuratorTaskRef,
    { taskId: task._id },
  );
  await ctx.db.patch(task._id, {
    status: "queued",
    mode: args.mode,
    attempt: args.attempt,
    effectiveModelIds: appendModel(task.effectiveModelIds, args.effectiveModelId),
    scheduledFunctionId,
    error: args.error.slice(0, 500),
    updatedAt: Date.now(),
  });
  await renewPresentationFanoutLease(ctx, run._id);
  return true;
}

export async function completePresentationCuratorTaskHandler(ctx: MutationCtx, args: {
  taskId: Id<"presentationCuratorTasks">;
  slides: ParsedPresentationSlide[];
  deleteSlideIds: string[];
  effectiveModelId?: string;
  error?: string;
}) {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.status !== "running") return { accepted: false, finalizerQueued: false };
  const run = await ctx.db.get(task.runId);
  if (!run || run.status !== "curating") return { accepted: false, finalizerQueued: false };
  const project = await ctx.db.get(run.projectId);
  if (!project || project.status !== "generating" || project.revision !== run.projectRevision) {
    return { accepted: false, finalizerQueued: false };
  }
  const candidates = await ctx.db.query("presentationSlideCandidates")
    .withIndex("by_run", (query) => query.eq("runId", run._id)).collect();
  const bySlideId = new Map(candidates.map((candidate) => [candidate.slideId, candidate]));
  if (args.slides.some((slide) => !task.slideIds.includes(slide.id))) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Curator edited a slide outside its task.");
  }
  const normalized = args.slides.map((slide) => {
    const current = bySlideId.get(slide.id);
    if (!current) throw presentationError("NOT_FOUND", "Curator candidate slide not found.");
    const inspected = inspectSlideHtml(slide.html, project.assetStorageIds ?? []);
    const harmonizedHtml = harmonizePresentationTypography(
      inspected.html,
      project.creativeDirection?.typographyRoles,
    );
    const normalizedHtml = harmonizedHtml === inspected.html
      ? inspected.html
      : inspectSlideHtml(harmonizedHtml, project.assetStorageIds ?? []).html;
    return {
      current,
      slide: {
        ...slide,
        title: requireBoundedText(slide.title, "Slide title", MAX_TITLE_CHARS),
        html: normalizedHtml,
      },
    };
  });
  const survivorId = task.slideIds[0];
  const deleteIds = [...new Set(args.deleteSlideIds)];
  if (deleteIds.length > 0) {
    if (task.kind !== "consolidate" || deleteIds.includes(survivorId) ||
        deleteIds.some((slideId) => !task.slideIds.includes(slideId))) {
      throw presentationError("VALIDATION", "Only a consolidation task may delete its duplicate slides.");
    }
    const survivorUpdate = normalized.find((entry) => entry.slide.id === survivorId)?.slide;
    const currentSurvivor = bySlideId.get(survivorId);
    const survivor = survivorUpdate
      ? {
        slideId: survivorUpdate.id,
        title: survivorUpdate.title,
        notes: survivorUpdate.notes,
        html: survivorUpdate.html,
      }
      : currentSurvivor;
    const sources = task.slideIds.map((slideId) => bySlideId.get(slideId)).filter((value) => value !== undefined);
    if (!survivor || sources.length !== task.slideIds.length ||
        !consolidationPreservesContent(sources, survivor)) {
      throw presentationError("VALIDATION", "Duplicate deletion would lose distinct slide content.");
    }
  }
  const now = Date.now();
  for (const { current, slide } of normalized) {
    await ctx.db.patch(current._id, {
      title: slide.title,
      notes: slide.notes?.trim() || undefined,
      html: slide.html,
      effectiveModelId: args.effectiveModelId ?? current.effectiveModelId,
      revision: current.revision + 1,
      updatedAt: now,
    });
  }
  for (const slideId of deleteIds) {
    const candidate = bySlideId.get(slideId);
    if (candidate) await ctx.db.delete(candidate._id);
  }
  await ctx.db.patch(task._id, {
    status: "complete",
    effectiveModelIds: appendModel(task.effectiveModelIds, args.effectiveModelId),
    error: args.error?.slice(0, 500),
    completedAt: now,
    updatedAt: now,
  });
  const expectedSlideIds = run.expectedSlideIds.filter((slideId) => !deleteIds.includes(slideId));
  const tasks = await ctx.db.query("presentationCuratorTasks")
    .withIndex("by_run", (query) => query.eq("runId", run._id)).collect();
  const allComplete = tasks.every((entry) => entry._id === task._id || entry.status === "complete");
  await ctx.db.patch(run._id, {
    expectedSlideIds,
    deletedSlideIds: [...new Set([...run.deletedSlideIds, ...deleteIds])],
    updatedAt: now,
  });
  if (!allComplete) return { accepted: true, finalizerQueued: false };
  await queueFinalizer(ctx, run._id);
  return { accepted: true, finalizerQueued: true };
}
