import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import {
  applyAiSlideEditHandler,
  beginGenerationHandler,
  beginPlanningHandler,
  completeGenerationHandler,
  completePlanningHandler,
  expireWorkflowHandler,
  markFailedHandler,
  setWorkflowPhaseHandler,
} from "./workflow_mutation_handlers";
import { createChatProjectHandler } from "./mutations_project_handlers";
import { registerPptxReferenceAsset } from "./asset_ownership";
import { recordPresentationSnapshotHandler } from "./snapshot_persistence";
import {
  presentationDirectionValidator,
  presentationCreativeDirectionValidator,
  presentationImageModeValidator,
  presentationPlanValidator,
  presentationWorkflowPhaseValidator,
  projectRevisionResultValidator,
  slideRevisionResultValidator,
} from "./validators";

const workflowBaseArgs = {
  projectId: v.id("presentationProjects"),
  userId: v.string(),
  expectedRevision: v.number(),
  workflowManaged: v.optional(v.boolean()),
};

export const createChatProject = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    originUserMessageId: v.optional(v.id("messages")),
    originAssistantMessageId: v.optional(v.id("messages")),
    originToolCallId: v.optional(v.string()),
    sourceStorageId: v.optional(v.string()),
    assetStorageIds: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    prompt: v.string(),
    direction: presentationDirectionValidator,
    imageMode: presentationImageModeValidator,
  },
  returns: v.id("presentationProjects"),
  handler: createChatProjectHandler,
});

export const registerReferenceAsset = internalMutation({
  args: {
    userId: v.string(),
    sourceStorageId: v.id("_storage"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    altText: v.string(),
  },
  returns: v.id("_storage"),
  handler: registerPptxReferenceAsset,
});

export const recordSnapshot = internalMutation({
  args: {
    projectId: v.id("presentationProjects"),
    userId: v.string(),
    expectedRevision: v.number(),
    storageId: v.id("_storage"),
    sizeBytes: v.number(),
    kind: v.union(v.literal("fallback"), v.literal("browser_html")),
  },
  returns: v.object({
    projectId: v.id("presentationProjects"),
    snapshotRevision: v.number(),
    storageId: v.id("_storage"),
  }),
  handler: recordPresentationSnapshotHandler,
});

export const beginPlanning = internalMutation({
  args: {
    ...workflowBaseArgs,
    prompt: v.string(),
    direction: presentationDirectionValidator,
    imageMode: presentationImageModeValidator,
    modelId: v.string(),
  },
  returns: projectRevisionResultValidator,
  handler: beginPlanningHandler,
});

export const completePlanning = internalMutation({
  args: {
    ...workflowBaseArgs,
    title: v.string(),
    plan: presentationPlanValidator,
    creativeDirection: presentationCreativeDirectionValidator,
    effectiveModelIds: v.array(v.string()),
  },
  returns: projectRevisionResultValidator,
  handler: completePlanningHandler,
});

export const beginGeneration = internalMutation({
  args: { ...workflowBaseArgs, modelId: v.string() },
  returns: projectRevisionResultValidator,
  handler: beginGenerationHandler,
});

export const completeGeneration = internalMutation({
  args: {
    ...workflowBaseArgs,
    slides: v.array(v.object({
      id: v.string(),
      title: v.string(),
      notes: v.optional(v.string()),
      html: v.string(),
    })),
  },
  returns: v.object({
    projectId: v.id("presentationProjects"),
    projectRevision: v.number(),
    slideCount: v.number(),
  }),
  handler: completeGenerationHandler,
});

export const markFailed = internalMutation({
  args: { ...workflowBaseArgs, error: v.string() },
  returns: v.boolean(),
  handler: markFailedHandler,
});

export const setWorkflowPhase = internalMutation({
  args: { ...workflowBaseArgs, phase: presentationWorkflowPhaseValidator },
  returns: v.boolean(),
  handler: setWorkflowPhaseHandler,
});

export const expireWorkflow = internalMutation({
  args: workflowBaseArgs,
  returns: v.boolean(),
  handler: expireWorkflowHandler,
});

export const applyAiSlideEdit = internalMutation({
  args: {
    projectId: v.id("presentationProjects"),
    userId: v.string(),
    slideId: v.string(),
    expectedRevision: v.number(),
    title: v.string(),
    notes: v.optional(v.string()),
    html: v.string(),
  },
  returns: slideRevisionResultValidator,
  handler: applyAiSlideEditHandler,
});
