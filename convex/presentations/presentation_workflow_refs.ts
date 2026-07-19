import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ToolResult } from "../tools/registry";
import type { DeferredPresentationWorkflowArgs } from "./deferred_workflow_refs";

export type PresentationWorkflowState = {
  active: boolean;
  projectStatus: string | null;
  projectRevision: number | null;
  runStatus: string | null;
  finalizedRevision: number | null;
  error?: string;
};

export const presentationWorkflowRef = makeFunctionReference<
  "mutation",
  DeferredPresentationWorkflowArgs,
  null
>(
  "presentations/presentation_workflow:runPresentationWorkflow",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  DeferredPresentationWorkflowArgs,
  null
>;

export const startPresentationWorkflowRef = makeFunctionReference<
  "mutation",
  DeferredPresentationWorkflowArgs,
  string
>(
  "presentations/presentation_workflow_start:startPresentationWorkflow",
) as unknown as FunctionReference<
  "mutation",
  "internal",
  DeferredPresentationWorkflowArgs,
  string
>;

export const runPresentationPlanStepRef = makeFunctionReference<
  "action",
  DeferredPresentationWorkflowArgs,
  { projectRevision: number }
>(
  "presentations/presentation_workflow_steps:runPresentationPlanStep",
) as unknown as FunctionReference<
  "action",
  "internal",
  DeferredPresentationWorkflowArgs,
  { projectRevision: number }
>;

export const getPresentationWorkflowStateRef = makeFunctionReference<
  "query",
  { projectId: Id<"presentationProjects">; userId: string; jobId: Id<"generationJobs">; runId?: Id<"presentationGenerationRuns"> },
  PresentationWorkflowState
>(
  "presentations/presentation_workflow_state:getPresentationWorkflowState",
) as unknown as FunctionReference<
  "query",
  "internal",
  { projectId: Id<"presentationProjects">; userId: string; jobId: Id<"generationJobs">; runId?: Id<"presentationGenerationRuns"> },
  PresentationWorkflowState
>;

export const runPresentationSnapshotStepRef = makeFunctionReference<
  "action",
  DeferredPresentationWorkflowArgs & { expectedRevision: number },
  ToolResult
>(
  "presentations/presentation_workflow_steps:runPresentationSnapshotStep",
) as unknown as FunctionReference<
  "action",
  "internal",
  DeferredPresentationWorkflowArgs & { expectedRevision: number },
  ToolResult
>;

export const completePresentationParentStepRef = makeFunctionReference<
  "action",
  DeferredPresentationWorkflowArgs & { result: ToolResult },
  null
>(
  "presentations/presentation_workflow_steps:completePresentationParentStep",
) as unknown as FunctionReference<
  "action",
  "internal",
  DeferredPresentationWorkflowArgs & { result: ToolResult },
  null
>;

export const failPresentationWorkflowStepRef = makeFunctionReference<
  "action",
  DeferredPresentationWorkflowArgs & {
    error: string;
    runId?: Id<"presentationGenerationRuns">;
    cancelled?: boolean;
  },
  null
>(
  "presentations/presentation_workflow_steps:failPresentationWorkflowStep",
) as unknown as FunctionReference<
  "action",
  "internal",
  DeferredPresentationWorkflowArgs & { error: string; runId?: Id<"presentationGenerationRuns">; cancelled?: boolean },
  null
>;
