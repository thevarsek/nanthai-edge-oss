import {
  makeFunctionReference,
  type DefaultFunctionArgs,
  type FunctionReference,
} from "convex/server";
import type { Id } from "../_generated/dataModel";
import type {
  ParsedPresentationSlide,
  PresentationDirection,
  PresentationCreativeDirection,
  PresentationImageMode,
  PresentationPlanSlide,
  PresentationProjectDoc,
  PresentationProjectId,
  PresentationSlideDoc,
  ProjectRevisionResult,
  SlideRevisionResult,
  PresentationSnapshotKind,
  PresentationWorkflowPhase,
} from "./types";

type ProjectWithSlides = {
  project: PresentationProjectDoc;
  slides: PresentationSlideDoc[];
};

type WorkflowBaseArgs = {
  projectId: PresentationProjectId;
  userId: string;
  expectedRevision: number;
};

function internalRef<
  Kind extends "query" | "mutation",
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

export const getProjectInternalRef = internalRef<
  "query",
  { projectId: PresentationProjectId; userId: string },
  PresentationProjectDoc | null
>("presentations/queries:getProjectInternal");

export const getProjectAndSlideInternalRef = internalRef<
  "query",
  { projectId: PresentationProjectId; slideId: string; userId: string },
  { project: PresentationProjectDoc; slide: PresentationSlideDoc } | null
>("presentations/queries:getProjectAndSlideInternal");

export const getProjectWithSlidesInternalRef = internalRef<
  "query",
  { projectId: PresentationProjectId; userId: string },
  ProjectWithSlides | null
>("presentations/queries:getProjectWithSlidesInternal");

export const getLatestReadyProjectInternalRef = internalRef<
  "query",
  { userId: string; chatId: Id<"chats"> },
  ProjectWithSlides | null
>("presentations/queries:getLatestReadyProjectInternal");

export const getUnambiguousReadyProjectInternalRef = internalRef<
  "query",
  { userId: string; chatId: Id<"chats"> },
  ProjectWithSlides | null
>("presentations/queries:getUnambiguousReadyProjectInternal");

export const createChatProjectRef = internalRef<
  "mutation",
  {
    userId: string;
    chatId?: Id<"chats">;
    originUserMessageId?: Id<"messages">;
    originAssistantMessageId?: Id<"messages">;
    originToolCallId?: string;
    sourceStorageId?: string;
    assetStorageIds?: string[];
    title?: string;
    prompt: string;
    direction: PresentationDirection;
    imageMode: PresentationImageMode;
  },
  PresentationProjectId
>("presentations/mutations_internal:createChatProject");

export const beginPlanningRef = internalRef<
  "mutation",
  WorkflowBaseArgs & {
    prompt: string;
    direction: PresentationDirection;
    imageMode: PresentationImageMode;
    modelId: string;
  },
  ProjectRevisionResult
>("presentations/mutations_internal:beginPlanning");

export const completePlanningRef = internalRef<
  "mutation",
  WorkflowBaseArgs & {
    title: string;
    plan: PresentationPlanSlide[];
    creativeDirection: PresentationCreativeDirection;
    effectiveModelIds: string[];
  },
  ProjectRevisionResult
>("presentations/mutations_internal:completePlanning");

export const beginGenerationRef = internalRef<
  "mutation",
  WorkflowBaseArgs & { modelId: string },
  ProjectRevisionResult
>("presentations/mutations_internal:beginGeneration");

export const completeGenerationRef = internalRef<
  "mutation",
  WorkflowBaseArgs & { slides: ParsedPresentationSlide[] },
  ProjectRevisionResult & { slideCount: number }
>("presentations/mutations_internal:completeGeneration");

export const markFailedRef = internalRef<
  "mutation",
  WorkflowBaseArgs & { error: string },
  boolean
>("presentations/mutations_internal:markFailed");

export const setWorkflowPhaseRef = internalRef<
  "mutation",
  WorkflowBaseArgs & { phase: PresentationWorkflowPhase },
  boolean
>("presentations/mutations_internal:setWorkflowPhase");

export const expireWorkflowRef = internalRef<
  "mutation",
  WorkflowBaseArgs,
  boolean
>("presentations/mutations_internal:expireWorkflow");

export const applyAiSlideEditRef = internalRef<
  "mutation",
  {
    projectId: PresentationProjectId;
    userId: string;
    slideId: string;
    expectedRevision: number;
    title: string;
    notes?: string;
    html: string;
  },
  SlideRevisionResult
>("presentations/mutations_internal:applyAiSlideEdit");

export const recordSnapshotRef = internalRef<
  "mutation",
  {
    projectId: PresentationProjectId;
    userId: string;
    expectedRevision: number;
    storageId: Id<"_storage">;
    sizeBytes: number;
    kind: PresentationSnapshotKind;
  },
  { projectId: PresentationProjectId; snapshotRevision: number; storageId: Id<"_storage"> }
>("presentations/mutations_internal:recordSnapshot");
