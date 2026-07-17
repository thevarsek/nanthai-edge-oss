import {
  makeFunctionReference,
  type DefaultFunctionArgs,
  type FunctionReference,
} from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ParsedPresentationSlide } from "./types";

export type StudioActionArgs = {
  runId: Id<"presentationGenerationRuns">;
  batchId: Id<"presentationGenerationBatches">;
}

export type CuratorActionArgs = {
  runId: Id<"presentationGenerationRuns">;
}

export type CuratorTaskActionArgs = {
  taskId: Id<"presentationCuratorTasks">;
}

export type PresentationStudioContext = {
  run: Doc<"presentationGenerationRuns">;
  batch: Doc<"presentationGenerationBatches">;
  project: Doc<"presentationProjects">;
};

export type PresentationCuratorContext = {
  run: Doc<"presentationGenerationRuns">;
  project: Doc<"presentationProjects">;
  candidates: Doc<"presentationSlideCandidates">[];
  tasks: Doc<"presentationCuratorTasks">[];
};

function internalRef<
  Kind extends "query" | "mutation" | "action",
  Args extends DefaultFunctionArgs,
  Result,
>(name: string): FunctionReference<Kind, "internal", Args, Result> {
  return makeFunctionReference<Kind, Args, Result>(name) as unknown as FunctionReference<
    Kind,
    "internal",
    Args,
    Result
  >;
}

export const runPresentationStudioRef = internalRef<
  "action", StudioActionArgs, void
>("presentations/generation_studio_actions:runPresentationStudio");

export const runPresentationStudioRepairRef = internalRef<
  "action", StudioActionArgs, void
>("presentations/generation_studio_actions:runPresentationStudioRepair");

export const runPresentationCuratorRef = internalRef<
  "action", CuratorActionArgs, void
>("presentations/generation_curator_coordinator:runPresentationCurator");

export const runPresentationCuratorTaskRef = internalRef<
  "action", CuratorTaskActionArgs, void
>("presentations/generation_curator_actions:runPresentationCuratorTask");

export const runPresentationFinalizerRef = internalRef<
  "action", CuratorActionArgs, void
>("presentations/generation_curator_coordinator:runPresentationFinalizer");

export const getPresentationStudioContextRef = internalRef<
  "query", StudioActionArgs, PresentationStudioContext | null
>("presentations/generation_fanout_queries:getPresentationStudioContext");

export const getPresentationCuratorContextRef = internalRef<
  "query", CuratorActionArgs, PresentationCuratorContext | null
>("presentations/generation_fanout_queries:getPresentationCuratorContext");

export const getPresentationCuratorTaskContextRef = internalRef<
  "query", CuratorTaskActionArgs, (PresentationCuratorContext & {
    task: Doc<"presentationCuratorTasks">;
  }) | null
>("presentations/generation_fanout_queries:getPresentationCuratorTaskContext");

export const startPresentationFanoutRef = internalRef<
  "mutation",
  {
    projectId: Id<"presentationProjects">;
    userId: string;
    jobId: Id<"generationJobs">;
    toolCallId: string;
    expectedRevision: number;
    modelId: string;
    requireZdrOverride?: boolean;
  },
  { runId: Id<"presentationGenerationRuns">; started: boolean }
>("presentations/generation_fanout_mutations:startPresentationFanout");

export const claimPresentationStudioBatchRef = internalRef<
  "mutation", StudioActionArgs & { repair: boolean }, boolean
>("presentations/generation_fanout_mutations:claimPresentationStudioBatch");

export const queuePresentationStudioRepairRef = internalRef<
  "mutation",
  StudioActionArgs & {
    repairAttempt: number;
    candidateStorageId?: Id<"_storage">;
    targetSlideId?: string;
    validationError: string;
    validationCode?: string;
    validationDetails?: string;
    effectiveModelId?: string;
  },
  boolean
>("presentations/generation_fanout_mutations:queuePresentationStudioRepair");

export const completePresentationStudioBatchRef = internalRef<
  "mutation",
  StudioActionArgs & {
    slides: ParsedPresentationSlide[];
    effectiveModelId: string;
    allowLayoutIssues?: boolean;
  },
  { accepted: boolean; curatorQueued: boolean }
>("presentations/generation_fanout_mutations:completePresentationStudioBatch");

export const failPresentationFanoutRef = internalRef<
  "mutation",
  { runId: Id<"presentationGenerationRuns">; batchId?: Id<"presentationGenerationBatches">; error: string },
  boolean
>("presentations/generation_fanout_mutations:failPresentationFanout");

export const claimPresentationCuratorRef = internalRef<
  "mutation", CuratorActionArgs, boolean
>("presentations/generation_fanout_mutations:claimPresentationCurator");

export const startPresentationCuratorTasksRef = internalRef<
  "mutation",
  CuratorActionArgs & {
    tasks: Array<{
      taskKey: string;
      kind: "recompose" | "consolidate";
      slideIds: string[];
    }>;
  },
  { started: boolean; taskCount: number }
>("presentations/generation_fanout_mutations:startPresentationCuratorTasks");

export const claimPresentationCuratorTaskRef = internalRef<
  "mutation", CuratorTaskActionArgs, boolean
>("presentations/generation_fanout_mutations:claimPresentationCuratorTask");

export const retryPresentationCuratorTaskRef = internalRef<
  "mutation",
  CuratorTaskActionArgs & {
    mode: "patch" | "recreate";
    attempt: number;
    error: string;
    effectiveModelId?: string;
  },
  boolean
>("presentations/generation_fanout_mutations:retryPresentationCuratorTask");

export const completePresentationCuratorTaskRef = internalRef<
  "mutation",
  CuratorTaskActionArgs & {
    slides: ParsedPresentationSlide[];
    deleteSlideIds: string[];
    effectiveModelId?: string;
    error?: string;
  },
  { accepted: boolean; finalizerQueued: boolean }
>("presentations/generation_fanout_mutations:completePresentationCuratorTask");

export const finalizePresentationFanoutRef = internalRef<
  "mutation",
  CuratorActionArgs,
  { projectId: Id<"presentationProjects">; projectRevision: number; slideCount: number } | null
>("presentations/generation_fanout_mutations:finalizePresentationFanout");
