import { makeFunctionReference, type FunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";

export const VIDEO_GENERATION_MAX_POLL_COUNT = 40;

export type ToolVideoConfig = {
  resolution?: string;
  aspectRatio?: string;
  duration?: number;
  generateAudio?: boolean;
  seed?: number;
};

export type DeferredVideoWorkflowArgs = {
  videoJobId: Id<"videoJobs">;
  userId: string;
  jobId: Id<"generationJobs">;
  toolCallId: string;
  workflowResumeEventId: string;
};

export type ToolVideoExecution = {
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  claimantId: string;
};

export const deferredVideoWorkflowArgsValidator = {
  videoJobId: v.id("videoJobs"),
  userId: v.string(),
  jobId: v.id("generationJobs"),
  toolCallId: v.string(),
  workflowResumeEventId: v.string(),
};

export const toolVideoExecutionValidator = v.object({
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  claimantId: v.string(),
});

export const runToolVideoWorkflowRef = makeFunctionReference<
  "mutation",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution },
  null
>("tools/video_generation_workflow:runToolVideoWorkflow") as unknown as FunctionReference<
  "mutation",
  "internal",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution },
  null
>;

export const startToolVideoWorkflowRef = makeFunctionReference<
  "mutation",
  DeferredVideoWorkflowArgs,
  string
>("tools/video_generation_start:startToolVideoWorkflow") as unknown as FunctionReference<
  "mutation",
  "internal",
  DeferredVideoWorkflowArgs,
  string
>;

export const submitToolVideoStepRef = makeFunctionReference<
  "action",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution },
  "pending" | "completed" | "failed" | "cancelled"
>("tools/video_generation_actions:submitToolVideoStep") as unknown as FunctionReference<
  "action",
  "internal",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution },
  "pending" | "completed" | "failed" | "cancelled"
>;

export const pollToolVideoStepRef = makeFunctionReference<
  "action",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution },
  "pending" | "completed" | "failed" | "cancelled"
>("tools/video_generation_actions:pollToolVideoStep") as unknown as FunctionReference<
  "action",
  "internal",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution },
  "pending" | "completed" | "failed" | "cancelled"
>;

export const failToolVideoStepRef = makeFunctionReference<
  "action",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution; error: string },
  null
>("tools/video_generation_actions:failToolVideoStep") as unknown as FunctionReference<
  "action",
  "internal",
  DeferredVideoWorkflowArgs & { execution: ToolVideoExecution; error: string },
  null
>;
