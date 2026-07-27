import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";

export type DeferredPresentationWorkflowArgs = {
  projectId: Id<"presentationProjects">;
  userId: string;
  jobId: Id<"generationJobs">;
  toolCallId: string;
  modelId: string;
  requireZdrOverride?: boolean;
  workflowResumeEventId: string;
};

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
