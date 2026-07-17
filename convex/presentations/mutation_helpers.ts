import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { PresentationProjectDoc, PresentationSlideDoc } from "./types";

export async function getOwnedProject(
  ctx: MutationCtx,
  projectId: Id<"presentationProjects">,
  userId: string,
): Promise<PresentationProjectDoc> {
  const project = await ctx.db.get("presentationProjects", projectId);
  if (!project || project.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Presentation not found or unauthorized.",
    });
  }
  return project;
}

export async function getOwnedSlide(
  ctx: MutationCtx,
  projectId: Id<"presentationProjects">,
  slideId: string,
  userId: string,
): Promise<PresentationSlideDoc> {
  const slide = await ctx.db
    .query("presentationSlides")
    .withIndex("by_project_slide", (query) =>
      query.eq("projectId", projectId).eq("slideId", slideId),
    )
    .first();
  if (!slide || slide.userId !== userId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Presentation slide not found or unauthorized.",
    });
  }
  return slide;
}

export function throwRevisionConflict(
  subject: "project" | "slide",
  currentRevision: number,
): never {
  throw new ConvexError({
    code: "REVISION_CONFLICT",
    message: `The ${subject} changed since it was opened. Refresh and try again.`,
    currentRevision,
  });
}
