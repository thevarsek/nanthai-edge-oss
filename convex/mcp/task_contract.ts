import { v } from "convex/values";

export const remoteTaskResumeValue = v.object({
  action: v.union(v.literal("continue"), v.literal("cancel")),
});

export const remoteTaskExecution = v.object({
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  claimantId: v.string(),
});
