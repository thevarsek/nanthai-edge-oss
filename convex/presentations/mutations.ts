import { v } from "convex/values";
import { mutation } from "../_generated/server";
import {
  createProjectHandler,
  deleteProjectHandler,
  renameProjectHandler,
} from "./mutations_project_handlers";
import {
  deleteSlideHandler,
  duplicateSlideHandler,
  reorderSlidesHandler,
  saveSlideHandler,
} from "./mutations_slide_handlers";
import {
  presentationDirectionValidator,
  presentationImageModeValidator,
  projectRevisionResultValidator,
  slideRevisionResultValidator,
} from "./validators";

export const createProject = mutation({
  args: {
    title: v.optional(v.string()),
    prompt: v.string(),
    direction: presentationDirectionValidator,
    imageMode: presentationImageModeValidator,
    assetStorageIds: v.optional(v.array(v.id("_storage"))),
  },
  returns: v.id("presentationProjects"),
  handler: createProjectHandler,
});

export const saveSlide = mutation({
  args: {
    projectId: v.id("presentationProjects"),
    slideId: v.string(),
    expectedRevision: v.number(),
    title: v.string(),
    notes: v.optional(v.union(v.string(), v.null())),
    html: v.string(),
  },
  returns: slideRevisionResultValidator,
  handler: async (ctx, args) => await saveSlideHandler(ctx, args),
});

export const renameProject = mutation({
  args: {
    projectId: v.id("presentationProjects"),
    title: v.string(),
    expectedRevision: v.number(),
  },
  returns: projectRevisionResultValidator,
  handler: renameProjectHandler,
});

export const reorderSlides = mutation({
  args: {
    projectId: v.id("presentationProjects"),
    expectedProjectRevision: v.number(),
    orderedSlideIds: v.array(v.string()),
  },
  returns: projectRevisionResultValidator,
  handler: reorderSlidesHandler,
});

export const duplicateSlide = mutation({
  args: {
    projectId: v.id("presentationProjects"),
    slideId: v.string(),
    expectedProjectRevision: v.number(),
    expectedSlideRevision: v.number(),
  },
  returns: slideRevisionResultValidator,
  handler: duplicateSlideHandler,
});

export const deleteSlide = mutation({
  args: {
    projectId: v.id("presentationProjects"),
    slideId: v.string(),
    expectedProjectRevision: v.number(),
    expectedSlideRevision: v.number(),
  },
  returns: projectRevisionResultValidator,
  handler: deleteSlideHandler,
});

export const deleteProject = mutation({
  args: {
    projectId: v.id("presentationProjects"),
    expectedRevision: v.number(),
  },
  returns: v.null(),
  handler: deleteProjectHandler,
});
