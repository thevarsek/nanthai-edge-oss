import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import {
  MAX_PROJECTS_PER_USER,
  MAX_PROMPT_CHARS,
  MAX_TITLE_CHARS,
  assertProjectCanBeEdited,
  assertRevision,
  presentationError,
  requireBoundedText,
} from "./limits";
import { getOwnedProject, throwRevisionConflict } from "./mutation_helpers";
import type { PresentationDirection, PresentationImageMode } from "./types";
import { attachProjectAssets, resolveProjectAssets } from "./asset_ownership";

export interface CreateProjectArgs {
  title?: string;
  prompt: string;
  direction: PresentationDirection;
  imageMode: PresentationImageMode;
  assetStorageIds?: Id<"_storage">[];
}

export interface CreateChatProjectArgs extends Omit<CreateProjectArgs, "assetStorageIds"> {
  userId: string;
  chatId?: Id<"chats">;
  originUserMessageId?: Id<"messages">;
  originAssistantMessageId?: Id<"messages">;
  originToolCallId?: string;
  sourceStorageId?: Id<"_storage"> | string;
  assetStorageIds?: Array<Id<"_storage"> | string>;
}

function normalizeStorageId(
  ctx: MutationCtx,
  value: Id<"_storage"> | string | undefined,
): Id<"_storage"> | undefined {
  if (!value) return undefined;
  const normalized = ctx.db.system.normalizeId("_storage", String(value));
  if (!normalized) {
    throw presentationError("VALIDATION", "A presentation storage reference was invalid. Remove the placeholder and try again.");
  }
  return normalized;
}

async function insertProjectForUser(
  ctx: MutationCtx,
  args: CreateChatProjectArgs,
): Promise<Id<"presentationProjects">> {
  const sourceStorageId = normalizeStorageId(ctx, args.sourceStorageId);
  const assetStorageIds = args.assetStorageIds?.map((value) => {
    const normalized = normalizeStorageId(ctx, value);
    if (!normalized) {
      throw presentationError("VALIDATION", "A reusable presentation asset reference was invalid.");
    }
    return normalized;
  });
  const prompt = requireBoundedText(args.prompt, "Presentation brief", MAX_PROMPT_CHARS);
  const title = args.title?.trim()
    ? requireBoundedText(args.title, "Presentation title", MAX_TITLE_CHARS)
    : "Untitled presentation";
  if (args.originAssistantMessageId) {
    const existingTurnProject = await ctx.db
      .query("presentationProjects")
      .withIndex("by_origin_assistant", (query) =>
        query.eq("originAssistantMessageId", args.originAssistantMessageId)
      )
      .order("desc")
      .first();
    if (existingTurnProject) {
      throw presentationError(
        "PRESENTATION_ALREADY_ATTEMPTED",
        "This assistant turn already started a presentation. Continue its backend repair or report its final result instead of creating another project.",
      );
    }
  }
  const existingProjects = await ctx.db
    .query("presentationProjects")
    .withIndex("by_user", (query) => query.eq("userId", args.userId))
    .take(MAX_PROJECTS_PER_USER);
  if (existingProjects.length >= MAX_PROJECTS_PER_USER) {
    throw presentationError(
      "PROJECT_LIMIT",
      `You can keep up to ${MAX_PROJECTS_PER_USER} presentations. Delete one before creating another.`,
    );
  }
  if (args.chatId) {
    const chat = await ctx.db.get("chats", args.chatId);
    if (!chat || chat.userId !== args.userId) {
      throw presentationError("NOT_FOUND", "Chat not found or unauthorized.");
    }
  }
  if (sourceStorageId) {
    const [attachment, generatedFile] = await Promise.all([
      ctx.db
        .query("fileAttachments")
        .withIndex("by_storage", (query) => query.eq("storageId", sourceStorageId))
        .first(),
      ctx.db
        .query("generatedFiles")
        .withIndex("by_storage", (query) => query.eq("storageId", sourceStorageId))
        .first(),
    ]);
    if (attachment?.userId !== args.userId && generatedFile?.userId !== args.userId) {
      throw presentationError("NOT_FOUND", "Presentation source file not found or unauthorized.");
    }
  }
  const assets = await resolveProjectAssets(
    ctx,
    args.userId,
    assetStorageIds ?? [],
    sourceStorageId,
  );
  const now = Date.now();
  const projectId = await ctx.db.insert("presentationProjects", {
    userId: args.userId,
    chatId: args.chatId,
    originUserMessageId: args.originUserMessageId,
    originAssistantMessageId: args.originAssistantMessageId,
    originToolCallId: args.originToolCallId,
    sourceStorageId,
    assetStorageIds: assets.length > 0 ? assets.map((asset) => asset.storageId) : undefined,
    title,
    status: "draft",
    workflowPhase: "queued",
    sourceKind: sourceStorageId ? "pptx_rebuild" : "scratch",
    prompt,
    direction: args.direction,
    imageMode: args.imageMode,
    aspectRatio: "16:9",
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
  await attachProjectAssets(ctx, projectId, args.userId, assets);
  return projectId;
}

export async function createProjectHandler(
  ctx: MutationCtx,
  args: CreateProjectArgs,
): Promise<Id<"presentationProjects">> {
  const { userId } = await requireAuth(ctx);
  return await insertProjectForUser(ctx, { ...args, userId });
}

export async function createChatProjectHandler(
  ctx: MutationCtx,
  args: CreateChatProjectArgs,
): Promise<Id<"presentationProjects">> {
  return await insertProjectForUser(ctx, args);
}

export async function deleteProjectHandler(
  ctx: MutationCtx,
  args: {
    projectId: Id<"presentationProjects">;
    expectedRevision: number;
  },
): Promise<null> {
  const { userId } = await requireAuth(ctx);
  const project = await getOwnedProject(ctx, args.projectId, userId);
  assertProjectCanBeEdited(project.status);
  assertRevision(args.expectedRevision, "Expected project revision");
  if (project.revision !== args.expectedRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const slides = await ctx.db
    .query("presentationSlides")
    .withIndex("by_project", (query) => query.eq("projectId", args.projectId))
    .collect();
  const assets = await ctx.db
    .query("presentationAssets")
    .withIndex("by_project", (query) => query.eq("projectId", args.projectId))
    .collect();
  const generatedFiles = await ctx.db
    .query("generatedFiles")
    .withIndex("by_presentation_project", (query) =>
      query.eq("presentationProjectId", args.projectId)
    )
    .collect();
  const generationRuns = await ctx.db
    .query("presentationGenerationRuns")
    .withIndex("by_project_revision", (query) => query.eq("projectId", args.projectId))
    .collect();
  for (const run of generationRuns) {
    const [batches, candidates, tasks] = await Promise.all([
      ctx.db.query("presentationGenerationBatches")
        .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
      ctx.db.query("presentationSlideCandidates")
        .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
      ctx.db.query("presentationCuratorTasks")
        .withIndex("by_run", (query) => query.eq("runId", run._id)).collect(),
    ]);
    await Promise.all(batches.map(async (batch) => {
      if (batch.candidateStorageId) {
        try {
          await ctx.storage.delete(batch.candidateStorageId);
        } catch {
          // Scheduled cleanup may already have removed the private candidate.
        }
      }
      await ctx.db.delete(batch._id);
    }));
    await Promise.all(candidates.map((candidate) => ctx.db.delete(candidate._id)));
    await Promise.all(tasks.map((task) => ctx.db.delete(task._id)));
    await ctx.db.delete(run._id);
  }
  await Promise.all(slides.map((slide) => ctx.db.delete("presentationSlides", slide._id)));
  await Promise.all(assets.map((asset) => ctx.db.delete("presentationAssets", asset._id)));
  if (project.snapshotStorageId && generatedFiles.length === 0) {
    try {
      await ctx.storage.delete(project.snapshotStorageId);
    } catch {
      // Storage blob may already be deleted.
    }
  }
  await ctx.db.delete("presentationProjects", args.projectId);
  return null;
}

export async function renameProjectHandler(
  ctx: MutationCtx,
  args: {
    projectId: Id<"presentationProjects">;
    title: string;
    expectedRevision: number;
  },
) {
  const { userId } = await requireAuth(ctx);
  const project = await getOwnedProject(ctx, args.projectId, userId);
  assertProjectCanBeEdited(project.status);
  assertRevision(args.expectedRevision, "Expected project revision");
  if (project.revision !== args.expectedRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const projectRevision = project.revision + 1;
  await ctx.db.patch("presentationProjects", project._id, {
    title: requireBoundedText(args.title, "Presentation title", MAX_TITLE_CHARS),
    revision: projectRevision,
    updatedAt: Date.now(),
  });
  return { projectId: project._id, projectRevision };
}
