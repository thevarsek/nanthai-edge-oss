import { v } from "convex/values";
import { action } from "../_generated/server";
import { applyAiEditHandler } from "./action_edit_handler";
import { generateProjectHandler } from "./action_generate_handler";
import { planProjectHandler } from "./action_plan_handler";
import { persistBrowserSnapshotHandler } from "./snapshot_persistence";
import {
  editedSlideResultValidator,
  presentationDirectionValidator,
  presentationImageModeValidator,
  presentationPlanValidator,
} from "./validators";

export const planProject = action({
  args: {
    projectId: v.id("presentationProjects"),
    prompt: v.string(),
    direction: presentationDirectionValidator,
    imageMode: presentationImageModeValidator,
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    projectId: v.id("presentationProjects"),
    status: v.literal("planned"),
    projectRevision: v.number(),
    plan: presentationPlanValidator,
  }),
  handler: planProjectHandler,
});

export const generateProject = action({
  args: {
    projectId: v.id("presentationProjects"),
    modelId: v.optional(v.string()),
  },
  returns: v.object({
    projectId: v.id("presentationProjects"),
    status: v.literal("ready"),
    projectRevision: v.number(),
    slideCount: v.number(),
  }),
  handler: generateProjectHandler,
});

export const applyAiEdit = action({
  args: {
    projectId: v.id("presentationProjects"),
    slideId: v.string(),
    instruction: v.string(),
    expectedRevision: v.number(),
    modelId: v.optional(v.string()),
  },
  returns: editedSlideResultValidator,
  handler: applyAiEditHandler,
});

export const persistSnapshot = action({
  args: {
    projectId: v.id("presentationProjects"),
    expectedRevision: v.number(),
    storageId: v.id("_storage"),
    sizeBytes: v.number(),
  },
  returns: v.object({
    projectId: v.id("presentationProjects"),
    snapshotRevision: v.number(),
    storageId: v.id("_storage"),
  }),
  handler: persistBrowserSnapshotHandler,
});
