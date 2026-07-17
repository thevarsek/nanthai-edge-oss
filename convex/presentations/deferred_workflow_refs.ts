import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";

export type DeferredPresentationWorkflowArgs = {
  projectId: Id<"presentationProjects">;
  userId: string;
  jobId: Id<"generationJobs">;
  toolCallId: string;
  modelId: string;
  requireZdrOverride?: boolean;
};

export type DeferredPresentationRepairArgs = DeferredPresentationWorkflowArgs & {
  invalidResponse: string;
  validationError: string;
  candidateStorageId?: Id<"_storage">;
  targetSlideId?: string;
  repairAttempt?: number;
  priorEffectiveModelId?: string;
};

export function presentationWorkflowArgs(
  args: DeferredPresentationWorkflowArgs,
): DeferredPresentationWorkflowArgs {
  const workflowArgs: DeferredPresentationWorkflowArgs = {
    projectId: args.projectId,
    userId: args.userId,
    jobId: args.jobId,
    toolCallId: args.toolCallId,
    modelId: args.modelId,
  };
  if (args.requireZdrOverride !== undefined) {
    workflowArgs.requireZdrOverride = args.requireZdrOverride;
  }
  return workflowArgs;
}

function workflowActionRef(name: string): FunctionReference<
  "action",
  "internal",
  DeferredPresentationWorkflowArgs,
  void
> {
  return makeFunctionReference<"action", DeferredPresentationWorkflowArgs, void>(
    name,
  ) as unknown as FunctionReference<
    "action",
    "internal",
    DeferredPresentationWorkflowArgs,
    void
  >;
}

export const runDeferredPresentationPlanRef = workflowActionRef(
  "presentations/deferred_workflow_actions:runDeferredPresentationPlan",
);

export const runDeferredPresentationGenerateRef = workflowActionRef(
  "presentations/deferred_workflow_actions:runDeferredPresentationGenerate",
);

function repairActionRef(name: string): FunctionReference<
  "action",
  "internal",
  DeferredPresentationRepairArgs,
  void
> {
  return makeFunctionReference<"action", DeferredPresentationRepairArgs, void>(
    name,
  ) as unknown as FunctionReference<
    "action",
    "internal",
    DeferredPresentationRepairArgs,
    void
  >;
}

export const runDeferredPresentationPlanRepairRef = repairActionRef(
  "presentations/deferred_workflow_repair_actions:runDeferredPresentationPlanRepair",
);

export const runDeferredPresentationGenerateRepairRef = repairActionRef(
  "presentations/deferred_workflow_repair_actions:runDeferredPresentationGenerateRepair",
);

export const runDeferredPresentationSnapshotRef = workflowActionRef(
  "presentations/deferred_workflow_actions:runDeferredPresentationSnapshot",
);

export const expireDeferredPresentationRef = workflowActionRef(
  "presentations/deferred_workflow_actions:expireDeferredPresentation",
);

export const deletePresentationRepairCandidateRef = makeFunctionReference<
  "action",
  { storageId: Id<"_storage"> },
  void
>(
  "presentations/deferred_repair_candidate_cleanup:deletePresentationRepairCandidate",
) as unknown as FunctionReference<
  "action",
  "internal",
  { storageId: Id<"_storage"> },
  void
>;
