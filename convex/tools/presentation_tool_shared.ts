import type { Id } from "../_generated/dataModel";
import {
  getLatestReadyProjectInternalRef,
  getProjectWithSlidesInternalRef,
  getUnambiguousReadyProjectInternalRef,
} from "../presentations/action_refs";
import type {
  PresentationProjectDoc,
  PresentationSlideDoc,
} from "../presentations/types";
import type { ToolExecutionContext } from "./registry";

export type OwnedPresentation = {
  project: PresentationProjectDoc;
  slides: PresentationSlideDoc[];
};

export type PresentationToolTarget = {
  projectId?: string;
  projectRevision?: number;
  slideId?: string;
  slideRevision?: number;
  slideNumber?: number;
  elementId?: string;
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** Merge model arguments with the server-owned target selected in the composer. */
export function authoritativePresentationTarget(
  toolCtx: ToolExecutionContext,
  args: Record<string, unknown>,
): PresentationToolTarget {
  const supplied: PresentationToolTarget = {
    projectId: optionalString(args.projectId),
    projectRevision: optionalNumber(args.projectRevision),
    slideId: optionalString(args.slideId),
    slideRevision: optionalNumber(args.slideRevision),
    slideNumber: optionalNumber(args.slideNumber),
    elementId: optionalString(args.elementId),
  };
  const selected = toolCtx.presentationContext;
  if (!selected) return supplied;

  const mismatches = [
    supplied.projectId && supplied.projectId !== selected.projectId
      ? "projectId"
      : undefined,
    supplied.projectRevision !== undefined &&
      supplied.projectRevision !== selected.projectRevision
      ? "projectRevision"
      : undefined,
    selected.slideId && supplied.slideId && supplied.slideId !== selected.slideId
      ? "slideId"
      : undefined,
    selected.slideRevision !== undefined &&
      supplied.slideRevision !== undefined &&
      supplied.slideRevision !== selected.slideRevision
      ? "slideRevision"
      : undefined,
    selected.elementId && supplied.elementId && supplied.elementId !== selected.elementId
      ? "elementId"
      : undefined,
  ].filter((value): value is string => value !== undefined);
  if (mismatches.length > 0) {
    throw new Error(
      `The tool arguments did not match the user's selected presentation target (${mismatches.join(", ")}).`,
    );
  }

  return {
    ...supplied,
    projectId: String(selected.projectId),
    projectRevision: selected.projectRevision,
    slideId: selected.slideId ?? supplied.slideId,
    slideRevision: selected.slideRevision ?? supplied.slideRevision,
    elementId: selected.elementId ?? supplied.elementId,
  };
}

export function assertSelectedPresentationRevisions(
  presentation: OwnedPresentation,
  target: PresentationToolTarget,
  slide?: PresentationSlideDoc,
): void {
  if (
    target.projectRevision !== undefined &&
    target.projectRevision !== presentation.project.revision
  ) {
    throw new Error(
      `Presentation changed; current revision is ${presentation.project.revision}. Reselect it before editing.`,
    );
  }
  if (
    slide &&
    target.slideRevision !== undefined &&
    target.slideRevision !== slide.revision
  ) {
    throw new Error(
      `Slide changed; current revision is ${slide.revision}. Reselect it before editing.`,
    );
  }
  if (
    slide &&
    target.slideNumber !== undefined &&
    target.slideNumber !== slide.position + 1
  ) {
    throw new Error("The requested slide number did not match the user's selected slide.");
  }
}

export async function resolveOwnedPresentation(
  toolCtx: ToolExecutionContext,
  projectId?: string,
  options?: { requireUnambiguous?: boolean },
): Promise<OwnedPresentation | null> {
  if (projectId?.trim()) {
    return await toolCtx.ctx.runQuery(getProjectWithSlidesInternalRef, {
      projectId: projectId.trim() as Id<"presentationProjects">,
      userId: toolCtx.userId,
    });
  }
  if (!toolCtx.chatId) return null;
  const queryRef = options?.requireUnambiguous
    ? getUnambiguousReadyProjectInternalRef
    : getLatestReadyProjectInternalRef;
  return await toolCtx.ctx.runQuery(queryRef, {
    userId: toolCtx.userId,
    chatId: toolCtx.chatId as Id<"chats">,
  });
}

export function selectPresentationSlide(
  presentation: OwnedPresentation,
  slideId?: string,
  slideNumber?: number,
): PresentationSlideDoc | undefined {
  if (slideId?.trim()) {
    return presentation.slides.find((slide) => slide.slideId === slideId.trim());
  }
  if (slideNumber !== undefined && Number.isInteger(slideNumber) && slideNumber >= 1) {
    return presentation.slides[slideNumber - 1];
  }
  return undefined;
}
