"use node";

import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import {
  getProjectWithSlidesInternalRef,
  recordSnapshotRef,
} from "../presentations/action_refs";
import type { ToolExecutionContext, ToolResult } from "./registry";
import { sanitizeFilename } from "./sanitize";

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const createPresentationSnapshotRef = makeFunctionReference<
  "action",
  { projectId: Id<"presentationProjects">; userId: string },
  ToolResult
>("tools/presentation_snapshot:createPresentationSnapshot") as unknown as FunctionReference<
  "action",
  "internal",
  { projectId: Id<"presentationProjects">; userId: string },
  ToolResult
>;

export async function snapshotResult(
  toolCtx: ToolExecutionContext,
  projectId: Id<"presentationProjects">,
  revision: number,
  toolName: "create_presentation" | "edit_presentation",
): Promise<ToolResult> {
  const presentation = await toolCtx.ctx.runQuery(getProjectWithSlidesInternalRef, {
    projectId,
    userId: toolCtx.userId,
  });
  if (!presentation) {
    return { success: false, data: null, error: "Presentation disappeared before export." };
  }
  const persistedStorageId = presentation.project.snapshotRevision === revision
    ? presentation.project.snapshotStorageId
    : undefined;
  const persistedSizeBytes = presentation.project.snapshotRevision === revision
    ? presentation.project.snapshotSizeBytes
    : undefined;
  if (persistedStorageId && persistedSizeBytes) {
    const persistedBlob = await toolCtx.ctx.storage.get(persistedStorageId);
    if (persistedBlob && persistedBlob.size === persistedSizeBytes) {
      return {
        success: true,
        data: {
          storageId: persistedStorageId,
          filename: `${sanitizeFilename(presentation.project.title, "presentation")}.pptx`,
          mimeType: PPTX_MIME_TYPE,
          sizeBytes: persistedSizeBytes,
          toolName,
          title: presentation.project.title,
          summary: `${presentation.slides.length}-slide editable presentation`,
          presentationProjectId: projectId,
          presentationRevision: revision,
        },
      };
    }
  }
  const snapshot = await toolCtx.ctx.runAction(createPresentationSnapshotRef, {
    projectId,
    userId: toolCtx.userId,
  });
  if (!snapshot.success) return snapshot;
  const result = snapshot.data as { storageId?: string; filename?: string };
  if (
    !result.storageId ||
    !result.filename ||
    !result.filename.toLowerCase().endsWith(".pptx")
  ) {
    return { success: false, data: null, error: "PowerPoint snapshot export failed." };
  }
  const blob = await toolCtx.ctx.storage.get(result.storageId as Id<"_storage">);
  if (!blob) {
    return { success: false, data: null, error: "PowerPoint snapshot was not stored." };
  }
  await toolCtx.ctx.runMutation(recordSnapshotRef, {
    projectId,
    userId: toolCtx.userId,
    expectedRevision: revision,
    storageId: result.storageId as Id<"_storage">,
    sizeBytes: blob.size,
    kind: "fallback",
  });
  return {
    success: true,
    data: {
      storageId: result.storageId,
      filename: result.filename,
      mimeType: PPTX_MIME_TYPE,
      sizeBytes: blob.size,
      toolName,
      title: presentation.project.title,
      summary: `${presentation.slides.length}-slide editable presentation`,
      presentationProjectId: projectId,
      presentationRevision: revision,
    },
  };
}
