import { v } from "convex/values";

export const deferredWorkflowArgsValidator = {
  projectId: v.id("presentationProjects"),
  userId: v.string(),
  jobId: v.id("generationJobs"),
  toolCallId: v.string(),
  modelId: v.string(),
  requireZdrOverride: v.optional(v.boolean()),
  workflowResumeEventId: v.string(),
};

export const workflowArgsValidator = {
  ...deferredWorkflowArgsValidator,
  executionAttemptId: v.id("executionAttempts"),
  executionFence: v.number(),
};
