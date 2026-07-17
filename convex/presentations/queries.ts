import { ConvexError, v } from "convex/values";
import { internalQuery, query } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { MAX_PROJECTS_PER_USER } from "./limits";
import {
  presentationProjectDocValidator,
  presentationProjectPayloadValidator,
  presentationProjectWithSlidesValidator,
  presentationSlideDocValidator,
} from "./validators";

export const list = query({
  args: {},
  returns: v.array(presentationProjectDocValidator),
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    return await ctx.db
      .query("presentationProjects")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .order("desc")
      .take(MAX_PROJECTS_PER_USER);
  },
});

export const getProject = query({
  args: { projectId: v.id("presentationProjects") },
  returns: v.union(v.null(), presentationProjectPayloadValidator),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const project = await ctx.db.get("presentationProjects", args.projectId);
    if (!project || project.userId !== userId) return null;
    const slides = await ctx.db
      .query("presentationSlides")
      .withIndex("by_project", (query) => query.eq("projectId", args.projectId))
      .collect();
    const assetRows = await ctx.db
      .query("presentationAssets")
      .withIndex("by_project", (query) => query.eq("projectId", args.projectId))
      .collect();
    const assets = (await Promise.all(assetRows
      .filter((asset) => asset.userId === userId)
      .map(async (asset) => {
        const url = await ctx.storage.getUrl(asset.storageId);
        return url ? {
          storageId: asset.storageId,
          filename: asset.filename,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          altText: asset.altText,
          kind: asset.kind,
          url,
        } : null;
      }))).filter((asset) => asset !== null);
    const snapshotDownloadUrl = project.snapshotStorageId
      ? await ctx.storage.getUrl(project.snapshotStorageId) ?? undefined
      : undefined;
    return {
      project,
      slides: slides.filter((slide) => slide.userId === userId),
      assets,
      snapshotDownloadUrl,
    };
  },
});

export const getProjectInternal = internalQuery({
  args: {
    projectId: v.id("presentationProjects"),
    userId: v.string(),
  },
  returns: v.union(v.null(), presentationProjectDocValidator),
  handler: async (ctx, args) => {
    const project = await ctx.db.get("presentationProjects", args.projectId);
    return project?.userId === args.userId ? project : null;
  },
});

export const getProjectAndSlideInternal = internalQuery({
  args: {
    projectId: v.id("presentationProjects"),
    slideId: v.string(),
    userId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      project: presentationProjectDocValidator,
      slide: presentationSlideDocValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const project = await ctx.db.get("presentationProjects", args.projectId);
    if (!project || project.userId !== args.userId) return null;
    const slide = await ctx.db
      .query("presentationSlides")
      .withIndex("by_project_slide", (query) =>
        query.eq("projectId", args.projectId).eq("slideId", args.slideId),
      )
      .first();
    if (!slide || slide.userId !== args.userId) return null;
    return { project, slide };
  },
});

export const getProjectWithSlidesInternal = internalQuery({
  args: {
    projectId: v.id("presentationProjects"),
    userId: v.string(),
  },
  returns: v.union(v.null(), presentationProjectWithSlidesValidator),
  handler: async (ctx, args) => {
    const project = await ctx.db.get("presentationProjects", args.projectId);
    if (!project || project.userId !== args.userId) return null;
    const slides = await ctx.db
      .query("presentationSlides")
      .withIndex("by_project", (query) => query.eq("projectId", project._id))
      .collect();
    return { project, slides: slides.filter((slide) => slide.userId === args.userId) };
  },
});

export const getLatestReadyProjectInternal = internalQuery({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
  },
  returns: v.union(v.null(), presentationProjectWithSlidesValidator),
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("presentationProjects")
      .withIndex("by_user_chat", (query) =>
        query.eq("userId", args.userId).eq("chatId", args.chatId)
      )
      .order("desc")
      .take(20);
    const project = projects.find((candidate) => candidate.status === "ready");
    if (!project) return null;
    const slides = await ctx.db
      .query("presentationSlides")
      .withIndex("by_project", (query) => query.eq("projectId", project._id))
      .collect();
    return { project, slides: slides.filter((slide) => slide.userId === args.userId) };
  },
});

export const getUnambiguousReadyProjectInternal = internalQuery({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
  },
  returns: v.union(v.null(), presentationProjectWithSlidesValidator),
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("presentationProjects")
      .withIndex("by_user_chat", (query) =>
        query.eq("userId", args.userId).eq("chatId", args.chatId)
      )
      .order("desc")
      .take(20);
    const readyProjects = projects.filter((candidate) => candidate.status === "ready");
    if (readyProjects.length > 1) {
      throw new ConvexError({
        code: "AMBIGUOUS_PRESENTATION" as const,
        message: "This chat contains multiple presentations. Open the intended file, select a slide or element, and ask again.",
      });
    }
    const project = readyProjects[0];
    if (!project) return null;
    const slides = await ctx.db
      .query("presentationSlides")
      .withIndex("by_project", (query) => query.eq("projectId", project._id))
      .collect();
    return { project, slides: slides.filter((slide) => slide.userId === args.userId) };
  },
});
