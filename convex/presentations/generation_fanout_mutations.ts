import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  claimPresentationCuratorHandler,
  claimPresentationCuratorTaskHandler,
  completePresentationCuratorTaskHandler,
  retryPresentationCuratorTaskHandler,
  startPresentationCuratorTasksHandler,
} from "./generation_curator_mutation_handlers";
import { finalizePresentationFanoutHandler } from "./generation_finalization_handler";
import { startPresentationFanoutHandler } from "./generation_fanout_start";
import {
  claimPresentationStudioBatchHandler,
  completePresentationStudioBatchHandler,
  failPresentationFanoutHandler,
  queuePresentationStudioRepairHandler,
} from "./generation_studio_mutation_handlers";

const studioIds = {
  runId: v.id("presentationGenerationRuns"),
  batchId: v.id("presentationGenerationBatches"),
};

const parsedSlide = v.object({
  id: v.string(),
  title: v.string(),
  notes: v.optional(v.string()),
  html: v.string(),
});

export const startPresentationFanout = internalMutation({
  args: {
    projectId: v.id("presentationProjects"),
    userId: v.string(),
    jobId: v.id("generationJobs"),
    toolCallId: v.string(),
    expectedRevision: v.number(),
    modelId: v.string(),
    requireZdrOverride: v.optional(v.boolean()),
  },
  returns: v.object({ runId: v.id("presentationGenerationRuns"), started: v.boolean() }),
  handler: startPresentationFanoutHandler,
});

export const claimPresentationStudioBatch = internalMutation({
  args: { ...studioIds, repair: v.boolean() },
  returns: v.boolean(),
  handler: claimPresentationStudioBatchHandler,
});

export const queuePresentationStudioRepair = internalMutation({
  args: {
    ...studioIds,
    repairAttempt: v.number(),
    candidateStorageId: v.optional(v.id("_storage")),
    targetSlideId: v.optional(v.string()),
    validationError: v.string(),
    validationCode: v.optional(v.string()),
    validationDetails: v.optional(v.string()),
    effectiveModelId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: queuePresentationStudioRepairHandler,
});

export const completePresentationStudioBatch = internalMutation({
  args: {
    ...studioIds,
    slides: v.array(parsedSlide),
    effectiveModelId: v.string(),
    allowLayoutIssues: v.optional(v.boolean()),
  },
  returns: v.object({ accepted: v.boolean(), curatorQueued: v.boolean() }),
  handler: completePresentationStudioBatchHandler,
});

export const failPresentationFanout = internalMutation({
  args: {
    runId: v.id("presentationGenerationRuns"),
    batchId: v.optional(v.id("presentationGenerationBatches")),
    error: v.string(),
  },
  returns: v.boolean(),
  handler: failPresentationFanoutHandler,
});

export const claimPresentationCurator = internalMutation({
  args: { runId: v.id("presentationGenerationRuns") },
  returns: v.boolean(),
  handler: claimPresentationCuratorHandler,
});

export const startPresentationCuratorTasks = internalMutation({
  args: {
    runId: v.id("presentationGenerationRuns"),
    tasks: v.array(v.object({
      taskKey: v.string(),
      kind: v.union(v.literal("recompose"), v.literal("consolidate")),
      slideIds: v.array(v.string()),
    })),
  },
  returns: v.object({ started: v.boolean(), taskCount: v.number() }),
  handler: startPresentationCuratorTasksHandler,
});

export const claimPresentationCuratorTask = internalMutation({
  args: { taskId: v.id("presentationCuratorTasks") },
  returns: v.boolean(),
  handler: claimPresentationCuratorTaskHandler,
});

export const retryPresentationCuratorTask = internalMutation({
  args: {
    taskId: v.id("presentationCuratorTasks"),
    mode: v.union(v.literal("patch"), v.literal("recreate")),
    attempt: v.number(),
    error: v.string(),
    effectiveModelId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: retryPresentationCuratorTaskHandler,
});

export const completePresentationCuratorTask = internalMutation({
  args: {
    taskId: v.id("presentationCuratorTasks"),
    slides: v.array(parsedSlide),
    deleteSlideIds: v.array(v.string()),
    effectiveModelId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.object({ accepted: v.boolean(), finalizerQueued: v.boolean() }),
  handler: completePresentationCuratorTaskHandler,
});

export const finalizePresentationFanout = internalMutation({
  args: { runId: v.id("presentationGenerationRuns") },
  returns: v.union(v.null(), v.object({
    projectId: v.id("presentationProjects"),
    projectRevision: v.number(),
    slideCount: v.number(),
  })),
  handler: finalizePresentationFanoutHandler,
});
