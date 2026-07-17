import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { inspectSlideHtml } from "./html_contract";
import {
  MAX_NOTES_CHARS,
  MAX_PRESENTATION_SLIDES,
  MAX_TITLE_CHARS,
  assertProjectCanBeEdited,
  assertRevision,
  presentationError,
  requireBoundedText,
} from "./limits";
import { getOwnedProject, getOwnedSlide, throwRevisionConflict } from "./mutation_helpers";

export interface SaveSlideArgs {
  projectId: Id<"presentationProjects">;
  slideId: string;
  expectedRevision: number;
  title: string;
  notes?: string | null;
  html: string;
}

export async function saveSlideHandler(ctx: MutationCtx, args: SaveSlideArgs) {
  const { userId } = await requireAuth(ctx);
  const project = await getOwnedProject(ctx, args.projectId, userId);
  assertProjectCanBeEdited(project.status);
  const slide = await getOwnedSlide(ctx, args.projectId, args.slideId, userId);
  assertRevision(args.expectedRevision, "Expected slide revision");
  if (slide.revision !== args.expectedRevision) {
    throwRevisionConflict("slide", slide.revision);
  }
  const title = requireBoundedText(args.title, "Slide title", MAX_TITLE_CHARS);
  const notes = args.notes == null ? args.notes : args.notes.trim();
  if (notes && notes.length > MAX_NOTES_CHARS) {
    throw presentationError("VALIDATION", "Slide notes are too long.");
  }
  const html = inspectSlideHtml(args.html, project.assetStorageIds ?? []).html;
  const now = Date.now();
  const slideRevision = slide.revision + 1;
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationSlides", slide._id, {
    title,
    ...(args.notes !== undefined ? { notes: notes || undefined } : {}),
    html,
    revision: slideRevision,
    updatedAt: now,
  });
  await ctx.db.patch("presentationProjects", project._id, {
    revision: projectRevision,
    updatedAt: now,
  });
  return { projectId: project._id, projectRevision, slideId: slide.slideId, slideRevision };
}

export async function reorderSlidesHandler(ctx: MutationCtx, args: {
  projectId: Id<"presentationProjects">;
  expectedProjectRevision: number;
  orderedSlideIds: string[];
}) {
  const { userId } = await requireAuth(ctx);
  const project = await getOwnedProject(ctx, args.projectId, userId);
  assertProjectCanBeEdited(project.status);
  assertRevision(args.expectedProjectRevision, "Expected project revision");
  if (project.revision !== args.expectedProjectRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const slides = await ctx.db
    .query("presentationSlides")
    .withIndex("by_project", (query) => query.eq("projectId", project._id))
    .collect();
  const requested = new Set(args.orderedSlideIds);
  const current = new Set(slides.map((slide) => slide.slideId));
  if (
    args.orderedSlideIds.length > MAX_PRESENTATION_SLIDES ||
    requested.size !== args.orderedSlideIds.length ||
    requested.size !== current.size ||
    [...requested].some((slideId) => !current.has(slideId))
  ) {
    throw presentationError("VALIDATION", "Slide order must contain every slide exactly once.");
  }
  const bySlideId = new Map(slides.map((slide) => [slide.slideId, slide]));
  const now = Date.now();
  await Promise.all(args.orderedSlideIds.map(async (slideId, position) => {
    const slide = bySlideId.get(slideId);
    if (!slide || slide.position === position) return;
    await ctx.db.patch("presentationSlides", slide._id, {
      position,
      revision: slide.revision + 1,
      updatedAt: now,
    });
  }));
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, {
    revision: projectRevision,
    updatedAt: now,
  });
  return { projectId: project._id, projectRevision };
}

export async function duplicateSlideHandler(ctx: MutationCtx, args: {
  projectId: Id<"presentationProjects">;
  slideId: string;
  expectedProjectRevision: number;
  expectedSlideRevision: number;
}) {
  const { userId } = await requireAuth(ctx);
  const project = await getOwnedProject(ctx, args.projectId, userId);
  assertProjectCanBeEdited(project.status);
  assertRevision(args.expectedProjectRevision, "Expected project revision");
  if (project.revision !== args.expectedProjectRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const source = await getOwnedSlide(ctx, args.projectId, args.slideId, userId);
  assertRevision(args.expectedSlideRevision, "Expected slide revision");
  if (source.revision !== args.expectedSlideRevision) {
    throwRevisionConflict("slide", source.revision);
  }
  const slides = await ctx.db
    .query("presentationSlides")
    .withIndex("by_project", (query) => query.eq("projectId", project._id))
    .collect();
  if (slides.length >= MAX_PRESENTATION_SLIDES) {
    throw new ConvexError({
      code: "SLIDE_LIMIT_REACHED",
      message: `Presentations support up to ${MAX_PRESENTATION_SLIDES} slides.`,
    });
  }
  const now = Date.now();
  const position = source.position + 1;
  await Promise.all(slides.filter((slide) => slide.position >= position).map((slide) =>
    ctx.db.patch("presentationSlides", slide._id, {
      position: slide.position + 1,
      revision: slide.revision + 1,
      updatedAt: now,
    }),
  ));
  const slideId = `slide-${crypto.randomUUID()}`;
  await ctx.db.insert("presentationSlides", {
    userId,
    projectId: project._id,
    slideId,
    position,
    title: `${source.title} copy`.slice(0, MAX_TITLE_CHARS),
    notes: source.notes,
    html: source.html,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, { revision: projectRevision, updatedAt: now });
  return { projectId: project._id, projectRevision, slideId, slideRevision: 0 };
}

export async function deleteSlideHandler(ctx: MutationCtx, args: {
  projectId: Id<"presentationProjects">;
  slideId: string;
  expectedProjectRevision: number;
  expectedSlideRevision: number;
}) {
  const { userId } = await requireAuth(ctx);
  const project = await getOwnedProject(ctx, args.projectId, userId);
  assertProjectCanBeEdited(project.status);
  assertRevision(args.expectedProjectRevision, "Expected project revision");
  if (project.revision !== args.expectedProjectRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const target = await getOwnedSlide(ctx, args.projectId, args.slideId, userId);
  assertRevision(args.expectedSlideRevision, "Expected slide revision");
  if (target.revision !== args.expectedSlideRevision) {
    throwRevisionConflict("slide", target.revision);
  }
  const slides = await ctx.db
    .query("presentationSlides")
    .withIndex("by_project", (query) => query.eq("projectId", project._id))
    .collect();
  if (slides.length <= 1) {
    throw presentationError("LAST_SLIDE", "A presentation must keep at least one slide.");
  }
  const now = Date.now();
  await ctx.db.delete("presentationSlides", target._id);
  await Promise.all(slides.filter((slide) => slide.position > target.position).map((slide) =>
    ctx.db.patch("presentationSlides", slide._id, {
      position: slide.position - 1,
      revision: slide.revision + 1,
      updatedAt: now,
    }),
  ));
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, { revision: projectRevision, updatedAt: now });
  return { projectId: project._id, projectRevision };
}
