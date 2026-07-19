import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { TERMINAL_GENERATION_JOB_STATUSES } from "../chat/generation_continuation_shared";
import { consolidationPreservesContent } from "./curation_analysis";
import {
  defaultCuratorDispatch,
  type PresentationCuratorDispatch,
  queueFinalizer,
} from "./generation_curator_mutation_handlers";
import {
  matchesPresentationExecution,
  type PresentationExecutionIdentity,
} from "./generation_execution_identity";
import { renewPresentationExecutionLease } from "./generation_fanout_start";
import { inspectSlideHtml } from "./html_contract";
import { MAX_TITLE_CHARS, presentationError, requireBoundedText } from "./limits";
import { harmonizePresentationTypography } from "./typography_harmonization";
import type { ParsedPresentationSlide } from "./types";

export async function completePresentationCuratorTaskHandler(ctx: MutationCtx, args: {
  taskId: Id<"presentationCuratorTasks">;
  slides: ParsedPresentationSlide[];
  deleteSlideIds: string[];
  effectiveModelId?: string;
  error?: string;
} & PresentationExecutionIdentity, dispatch: PresentationCuratorDispatch = defaultCuratorDispatch) {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.status !== "running") return { accepted: false, finalizerQueued: false };
  const run = await ctx.db.get(task.runId);
  if (!run || !matchesPresentationExecution(run, args) || run.status !== "curating") {
    return { accepted: false, finalizerQueued: false };
  }
  await renewPresentationExecutionLease(ctx, run._id, args);
  const job = await ctx.db.get(run.jobId);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) {
    return { accepted: false, finalizerQueued: false };
  }
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
    return {
      current,
      slide: {
        ...slide,
        title: requireBoundedText(slide.title, "Slide title", MAX_TITLE_CHARS),
        html: harmonizedHtml === inspected.html
          ? inspected.html
          : inspectSlideHtml(harmonizedHtml, project.assetStorageIds ?? []).html,
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
    const survivor = survivorUpdate ? {
      slideId: survivorUpdate.id,
      title: survivorUpdate.title,
      notes: survivorUpdate.notes,
      html: survivorUpdate.html,
    } : currentSurvivor;
    const sources = task.slideIds
      .map((slideId) => bySlideId.get(slideId))
      .filter((value) => value !== undefined);
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
    effectiveModelIds: args.effectiveModelId
      ? [...new Set([...task.effectiveModelIds, args.effectiveModelId])]
      : task.effectiveModelIds,
    error: args.error?.slice(0, 500),
    completedAt: now,
    updatedAt: now,
  });
  const tasks = await ctx.db.query("presentationCuratorTasks")
    .withIndex("by_run", (query) => query.eq("runId", run._id)).collect();
  const allComplete = tasks.every((entry) => entry._id === task._id || entry.status === "complete");
  await ctx.db.patch(run._id, {
    expectedSlideIds: run.expectedSlideIds.filter((slideId) => !deleteIds.includes(slideId)),
    deletedSlideIds: [...new Set([...run.deletedSlideIds, ...deleteIds])],
    updatedAt: now,
  });
  if (!allComplete) return { accepted: true, finalizerQueued: false };
  await queueFinalizer(ctx, run._id, args, dispatch);
  return { accepted: true, finalizerQueued: true };
}
