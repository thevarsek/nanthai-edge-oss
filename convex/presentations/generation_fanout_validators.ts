import { v } from "convex/values";
import { presentationProjectDocValidator } from "./validators";

export const presentationGenerationRunValidator = v.object({
  _id: v.id("presentationGenerationRuns"),
  _creationTime: v.number(),
  userId: v.string(),
  projectId: v.id("presentationProjects"),
  projectRevision: v.number(),
  jobId: v.id("generationJobs"),
  toolCallId: v.string(),
  selectedModelId: v.string(),
  requireZdrOverride: v.optional(v.boolean()),
  expectedSlideIds: v.array(v.string()),
  completedSlideIds: v.array(v.string()),
  deletedSlideIds: v.array(v.string()),
  studioCount: v.number(),
  status: v.union(
    v.literal("generating"), v.literal("curator_queued"),
    v.literal("curating"), v.literal("finalizing"),
    v.literal("complete"), v.literal("failed"),
  ),
  curatorWorkpoolOperationId: v.optional(v.string()),
  finalizerWorkpoolOperationId: v.optional(v.string()),
  workflowId: v.optional(v.string()),
  executionRunId: v.optional(v.id("executionRuns")),
  executionAttemptId: v.optional(v.id("executionAttempts")),
  executionFence: v.optional(v.number()),
  fanoutDispatchedFence: v.optional(v.number()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const presentationGenerationBatchValidator = v.object({
  _id: v.id("presentationGenerationBatches"),
  _creationTime: v.number(),
  runId: v.id("presentationGenerationRuns"),
  userId: v.string(),
  batchIndex: v.number(),
  slideIds: v.array(v.string()),
  status: v.union(
    v.literal("queued"), v.literal("running"), v.literal("repairing"),
    v.literal("complete"), v.literal("failed"),
  ),
  repairAttempt: v.number(),
  candidateStorageId: v.optional(v.id("_storage")),
  targetSlideId: v.optional(v.string()),
  validationError: v.optional(v.string()),
  validationDetails: v.optional(v.string()),
  validationHistory: v.optional(v.array(v.object({
    attempt: v.number(),
    slideId: v.optional(v.string()),
    code: v.optional(v.string()),
    message: v.string(),
    details: v.optional(v.string()),
  }))),
  effectiveModelIds: v.array(v.string()),
  workpoolOperationId: v.optional(v.string()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const presentationSlideCandidateValidator = v.object({
  _id: v.id("presentationSlideCandidates"),
  _creationTime: v.number(),
  runId: v.id("presentationGenerationRuns"),
  userId: v.string(),
  slideId: v.string(),
  position: v.number(),
  title: v.string(),
  notes: v.optional(v.string()),
  html: v.string(),
  effectiveModelId: v.string(),
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const presentationCuratorTaskValidator = v.object({
  _id: v.id("presentationCuratorTasks"),
  _creationTime: v.number(),
  runId: v.id("presentationGenerationRuns"),
  userId: v.string(),
  taskKey: v.string(),
  kind: v.union(v.literal("recompose"), v.literal("consolidate")),
  slideIds: v.array(v.string()),
  status: v.union(v.literal("queued"), v.literal("running"), v.literal("complete")),
  mode: v.union(v.literal("patch"), v.literal("recreate")),
  attempt: v.number(),
  effectiveModelIds: v.array(v.string()),
  workpoolOperationId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

export const presentationStudioContextValidator = v.object({
  run: presentationGenerationRunValidator,
  batch: presentationGenerationBatchValidator,
  project: presentationProjectDocValidator,
});

export const presentationCuratorContextValidator = v.object({
  run: presentationGenerationRunValidator,
  project: presentationProjectDocValidator,
  candidates: v.array(presentationSlideCandidateValidator),
  tasks: v.array(presentationCuratorTaskValidator),
});

export const presentationCuratorTaskContextValidator = v.object({
  run: presentationGenerationRunValidator,
  project: presentationProjectDocValidator,
  candidates: v.array(presentationSlideCandidateValidator),
  tasks: v.array(presentationCuratorTaskValidator),
  task: presentationCuratorTaskValidator,
});
