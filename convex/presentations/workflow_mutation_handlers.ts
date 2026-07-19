import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { inspectSlideHtml } from "./html_contract";
import { expireWorkflowRef } from "./action_refs";
import {
  MAX_PROMPT_CHARS,
  MAX_PRESENTATION_SLIDES,
  MAX_TITLE_CHARS,
  PRESENTATION_WORKFLOW_LEASE_MS,
  assertProjectCanBeEdited,
  assertRevision,
  presentationError,
  requireBoundedText,
} from "./limits";
import { getOwnedProject, getOwnedSlide, throwRevisionConflict } from "./mutation_helpers";
import { harmonizePresentationTypography } from "./typography_harmonization";
import type {
  ParsedPresentationSlide,
  PresentationDirection,
  PresentationCreativeDirection,
  PresentationImageMode,
  PresentationPlanSlide,
  PresentationStatus,
  PresentationWorkflowPhase,
} from "./types";

export interface WorkflowBaseArgs {
  projectId: Id<"presentationProjects">;
  userId: string;
  expectedRevision: number;
  workflowManaged?: boolean;
}
function assertStatus(actual: PresentationStatus, expected: PresentationStatus): void {
  if (actual !== expected) {
    throw presentationError(
      "INVALID_STATE",
      `Presentation must be ${expected} before this operation can continue.`,
    );
  }
}
function validatePlan(plan: PresentationPlanSlide[]): PresentationPlanSlide[] {
  if (plan.length < 1 || plan.length > MAX_PRESENTATION_SLIDES) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Presentation plan has an invalid slide count.");
  }
  if (new Set(plan.map((slide) => slide.id)).size !== plan.length) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Presentation plan has duplicate slide IDs.");
  }
  return plan;
}
export async function beginPlanningHandler(ctx: MutationCtx, args: WorkflowBaseArgs & {
  prompt: string;
  direction: PresentationDirection;
  imageMode: PresentationImageMode;
  modelId: string;
}) {
  const project = await getOwnedProject(ctx, args.projectId, args.userId);
  assertProjectCanBeEdited(project.status);
  assertRevision(args.expectedRevision, "Expected project revision");
  if (project.revision !== args.expectedRevision) throwRevisionConflict("project", project.revision);
  const now = Date.now();
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, {
    status: "planning",
    workflowPhase: "planning",
    prompt: requireBoundedText(args.prompt, "Presentation brief", MAX_PROMPT_CHARS),
    direction: args.direction,
    imageMode: args.imageMode,
    modelId: args.modelId,
    effectiveModelIds: undefined,
    modelFallbackUsed: undefined,
    plan: undefined,
    creativeDirection: undefined,
    error: undefined,
    revision: projectRevision,
    updatedAt: now,
  });
  if (!args.workflowManaged) {
    await ctx.scheduler.runAfter(PRESENTATION_WORKFLOW_LEASE_MS, expireWorkflowRef, {
      projectId: project._id,
      userId: args.userId,
      expectedRevision: projectRevision,
    });
  }
  return { projectId: project._id, projectRevision };
}
export async function completePlanningHandler(ctx: MutationCtx, args: WorkflowBaseArgs & {
  title: string;
  plan: PresentationPlanSlide[];
  creativeDirection: PresentationCreativeDirection;
  effectiveModelIds: string[];
}) {
  const project = await getOwnedProject(ctx, args.projectId, args.userId);
  assertStatus(project.status, "planning");
  if (project.revision !== args.expectedRevision) throwRevisionConflict("project", project.revision);
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, {
    title: requireBoundedText(args.title, "Presentation title", MAX_TITLE_CHARS),
    status: "planned",
    workflowPhase: "generating",
    plan: validatePlan(args.plan),
    creativeDirection: args.creativeDirection,
    effectiveModelIds: [...new Set(args.effectiveModelIds)],
    modelFallbackUsed: args.effectiveModelIds.some((modelId) => modelId !== project.modelId),
    error: undefined,
    revision: projectRevision,
    updatedAt: Date.now(),
  });
  if (!args.workflowManaged) {
    await ctx.scheduler.runAfter(PRESENTATION_WORKFLOW_LEASE_MS, expireWorkflowRef, {
      projectId: project._id,
      userId: args.userId,
      expectedRevision: projectRevision,
    });
  }
  return { projectId: project._id, projectRevision };
}
export async function beginGenerationHandler(ctx: MutationCtx, args: WorkflowBaseArgs & {
  modelId: string;
}) {
  const project = await getOwnedProject(ctx, args.projectId, args.userId);
  assertStatus(project.status, "planned");
  if (!project.plan?.length) {
    throw presentationError("INVALID_STATE", "Plan this presentation before generating slides.");
  }
  if (project.revision !== args.expectedRevision) throwRevisionConflict("project", project.revision);
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, {
    status: "generating",
    workflowPhase: "generating",
    modelId: args.modelId,
    error: undefined,
    revision: projectRevision,
    updatedAt: Date.now(),
  });
  if (!args.workflowManaged) {
    await ctx.scheduler.runAfter(PRESENTATION_WORKFLOW_LEASE_MS, expireWorkflowRef, {
      projectId: project._id,
      userId: args.userId,
      expectedRevision: projectRevision,
    });
  }
  return { projectId: project._id, projectRevision };
}
export async function completeGenerationHandler(ctx: MutationCtx, args: WorkflowBaseArgs & {
  slides: ParsedPresentationSlide[];
}) {
  const project = await getOwnedProject(ctx, args.projectId, args.userId);
  assertStatus(project.status, "generating");
  if (project.revision !== args.expectedRevision) throwRevisionConflict("project", project.revision);
  const plan = validatePlan(project.plan ?? []);
  if (
    args.slides.length !== plan.length ||
    args.slides.some((slide, index) => slide.id !== plan[index]?.id)
  ) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Generated slides do not match the saved plan.");
  }
  const normalizedSlides = args.slides.map((slide) => {
    const inspected = inspectSlideHtml(slide.html, project.assetStorageIds ?? []);
    const harmonizedHtml = harmonizePresentationTypography(
      inspected.html,
      project.creativeDirection?.typographyRoles,
    );
    return {
      ...slide,
      title: requireBoundedText(slide.title, "Slide title", MAX_TITLE_CHARS),
      html: harmonizedHtml === inspected.html
        ? inspected
        : inspectSlideHtml(harmonizedHtml, project.assetStorageIds ?? []),
    };
  });
  if (
    (project.imageMode === "references" || project.imageMode === "mixed") &&
    (project.assetStorageIds?.length ?? 0) > 0 &&
    !normalizedSlides.some((slide) => slide.html.usedAssetStorageIds.size > 0)
  ) {
    throw presentationError("MODEL_RESPONSE_INVALID", "Generated slides omitted every reusable reference asset.");
  }
  const existing = await ctx.db
    .query("presentationSlides")
    .withIndex("by_project", (query) => query.eq("projectId", project._id))
    .collect();
  await Promise.all(existing.map((slide) => ctx.db.delete("presentationSlides", slide._id)));
  const now = Date.now();
  await Promise.all(normalizedSlides.map((slide, position) =>
    ctx.db.insert("presentationSlides", {
      userId: args.userId,
      projectId: project._id,
      slideId: slide.id,
      position,
      title: slide.title,
      notes: slide.notes?.trim() || undefined,
      html: slide.html.html,
      revision: 0,
      createdAt: now,
      updatedAt: now,
    }),
  ));
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, {
    status: "ready",
    workflowPhase: "exporting",
    error: undefined,
    revision: projectRevision,
    updatedAt: now,
  });
  return { projectId: project._id, projectRevision, slideCount: normalizedSlides.length };
}

export async function markFailedHandler(ctx: MutationCtx, args: WorkflowBaseArgs & {
  error: string;
}) {
  const project = await ctx.db.get("presentationProjects", args.projectId);
  if (
    !project ||
    project.userId !== args.userId ||
    project.revision !== args.expectedRevision ||
    (project.status !== "planning" && project.status !== "generating")
  ) {
    return false;
  }
  await ctx.db.patch("presentationProjects", project._id, {
    status: "failed",
    workflowPhase: "failed",
    error: args.error.trim().slice(0, 500),
    revision: project.revision + 1,
    updatedAt: Date.now(),
  });
  return true;
}

export { expireWorkflowHandler } from "./workflow_expiry_handler";

export async function setWorkflowPhaseHandler(
  ctx: MutationCtx,
  args: WorkflowBaseArgs & { phase: PresentationWorkflowPhase },
): Promise<boolean> {
  const project = await ctx.db.get("presentationProjects", args.projectId);
  if (
    !project ||
    project.userId !== args.userId ||
    project.revision !== args.expectedRevision ||
    project.status === "failed"
  ) {
    return false;
  }
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, {
    workflowPhase: args.phase,
    revision: projectRevision,
    updatedAt: Date.now(),
  });
  if (!args.workflowManaged) {
    await ctx.scheduler.runAfter(PRESENTATION_WORKFLOW_LEASE_MS, expireWorkflowRef, {
      projectId: project._id,
      userId: args.userId,
      expectedRevision: projectRevision,
    });
  }
  return true;
}

export async function applyAiSlideEditHandler(ctx: MutationCtx, args: {
  projectId: Id<"presentationProjects">;
  userId: string;
  slideId: string;
  expectedRevision: number;
  title: string;
  notes?: string;
  html: string;
}) {
  const project = await getOwnedProject(ctx, args.projectId, args.userId);
  assertStatus(project.status, "ready");
  const slide = await getOwnedSlide(ctx, project._id, args.slideId, args.userId);
  if (slide.revision !== args.expectedRevision) throwRevisionConflict("slide", slide.revision);
  const current = inspectSlideHtml(slide.html, project.assetStorageIds ?? []);
  const edited = inspectSlideHtml(args.html, project.assetStorageIds ?? []);
  for (const elementId of current.elementIds) {
    if (!edited.elementIds.has(elementId)) {
      throw presentationError("MODEL_RESPONSE_INVALID", "AI edit removed a stable element ID.");
    }
  }
  const now = Date.now();
  const slideRevision = slide.revision + 1;
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationSlides", slide._id, {
    title: requireBoundedText(args.title, "Slide title", MAX_TITLE_CHARS),
    notes: args.notes?.trim() || undefined,
    html: edited.html,
    revision: slideRevision,
    updatedAt: now,
  });
  await ctx.db.patch("presentationProjects", project._id, {
    revision: projectRevision,
    updatedAt: now,
  });
  return { projectId: project._id, projectRevision, slideId: slide.slideId, slideRevision };
}
