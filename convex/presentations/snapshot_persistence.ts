import JSZip from "jszip";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { getProjectInternalRef, recordSnapshotRef } from "./action_refs";
import {
  MAX_PRESENTATION_SNAPSHOT_BYTES,
  assertRevision,
  presentationError,
} from "./limits";
import { throwRevisionConflict } from "./mutation_helpers";
import type { PresentationSnapshotKind } from "./types";

export interface RecordPresentationSnapshotArgs {
  projectId: Id<"presentationProjects">;
  userId: string;
  expectedRevision: number;
  storageId: Id<"_storage">;
  sizeBytes: number;
  kind: PresentationSnapshotKind;
}

async function deleteUnreferencedSnapshot(
  ctx: MutationCtx,
  storageId: Id<"_storage"> | undefined,
  replacementStorageId: Id<"_storage">,
): Promise<void> {
  if (!storageId || storageId === replacementStorageId) return;
  const [projectReference, generatedFileReference] = await Promise.all([
    ctx.db
      .query("presentationProjects")
      .withIndex("by_snapshot_storage", (query) => query.eq("snapshotStorageId", storageId))
      .first(),
    ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (query) => query.eq("storageId", storageId))
      .first(),
  ]);
  if (projectReference || generatedFileReference) return;
  try {
    await ctx.storage.delete(storageId);
  } catch {
    // The prior snapshot may already have been reclaimed by another cleanup path.
  }
}

export async function recordPresentationSnapshotHandler(
  ctx: MutationCtx,
  args: RecordPresentationSnapshotArgs,
) {
  assertRevision(args.expectedRevision, "Expected project revision");
  if (!Number.isSafeInteger(args.sizeBytes) || args.sizeBytes <= 0 ||
      args.sizeBytes > MAX_PRESENTATION_SNAPSHOT_BYTES) {
    throw presentationError("VALIDATION", "The PowerPoint snapshot size is invalid.");
  }
  const project = await ctx.db.get("presentationProjects", args.projectId);
  if (!project || project.userId !== args.userId) {
    throw presentationError("NOT_FOUND", "Presentation not found or unauthorized.");
  }
  if (project.revision !== args.expectedRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const previousStorageId = project.snapshotStorageId;
  await ctx.db.patch("presentationProjects", project._id, {
    snapshotStorageId: args.storageId,
    snapshotRevision: args.expectedRevision,
    snapshotSizeBytes: args.sizeBytes,
    snapshotKind: args.kind,
    workflowPhase: "complete",
    updatedAt: Date.now(),
  });
  if (args.kind === "browser_html") {
    const latestFile = await ctx.db
      .query("generatedFiles")
      .withIndex("by_presentation_project", (query) =>
        query.eq("presentationProjectId", project._id)
      )
      .order("desc")
      .first();
    if (latestFile?.userId === args.userId) {
      await ctx.db.patch("generatedFiles", latestFile._id, {
        storageId: args.storageId,
        sizeBytes: args.sizeBytes,
        presentationRevision: args.expectedRevision,
      });
    }
  }
  await deleteUnreferencedSnapshot(ctx, previousStorageId, args.storageId);
  return {
    projectId: project._id,
    snapshotRevision: args.expectedRevision,
    storageId: args.storageId,
  };
}

async function assertPptxBlob(blob: Blob): Promise<void> {
  if (blob.size <= 0 || blob.size > MAX_PRESENTATION_SNAPSHOT_BYTES) {
    throw presentationError("VALIDATION", "The PowerPoint snapshot size is invalid.");
  }
  try {
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    if (!zip.file("[Content_Types].xml") || !zip.file("ppt/presentation.xml")) {
      throw new Error("missing PowerPoint package entries");
    }
  } catch {
    throw presentationError("VALIDATION", "The uploaded snapshot is not a valid PowerPoint file.");
  }
}

export async function persistBrowserSnapshotHandler(
  ctx: ActionCtx,
  args: {
    projectId: Id<"presentationProjects">;
    expectedRevision: number;
    storageId: Id<"_storage">;
    sizeBytes: number;
  },
) {
  const { userId } = await requireAuth(ctx);
  const project = await ctx.runQuery(getProjectInternalRef, {
    projectId: args.projectId,
    userId,
  });
  if (!project) {
    throw presentationError("NOT_FOUND", "Presentation not found or unauthorized.");
  }
  if (project.revision !== args.expectedRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const blob = await ctx.storage.get(args.storageId);
  if (!blob || blob.size !== args.sizeBytes) {
    throw presentationError("VALIDATION", "The uploaded PowerPoint snapshot is unavailable.");
  }
  try {
    await assertPptxBlob(blob);
    return await ctx.runMutation(recordSnapshotRef, {
      projectId: project._id,
      userId,
      expectedRevision: args.expectedRevision,
      storageId: args.storageId,
      sizeBytes: blob.size,
      kind: "browser_html",
    });
  } catch (error) {
    try {
      await ctx.storage.delete(args.storageId);
    } catch {
      // Best-effort orphan cleanup.
    }
    throw error;
  }
}
