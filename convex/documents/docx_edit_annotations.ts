import { Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";

export type HydratedDocumentEditAnnotation = {
  type: "docx_edit_proposed";
  editId: Id<"documentEdits">;
  editBatchId: Id<"documentEditBatches">;
  generationKey: string;
  documentId: Id<"documents">;
  versionId: Id<"documentVersions">;
  baseVersionId: Id<"documentVersions">;
  introducedVersionId: Id<"documentVersions">;
  preResolutionVersionId?: Id<"documentVersions">;
  resolvedVersionId?: Id<"documentVersions">;
  generatedFileId?: Id<"generatedFiles">;
  filename: string;
  versionNumber: number;
  changeId: string;
  deletedText: string;
  insertedText: string;
  contextBefore?: string;
  contextAfter?: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
  displayStatus: "pending" | "accepted" | "rejected" | "superseded" | "unavailable";
  canUndo: boolean;
  resolvedAt?: number;
  unavailableReason?: string;
};

export async function hydrateDocumentEditAnnotation(
  ctx: QueryCtx | MutationCtx,
  snapshot: HydratedDocumentEditAnnotation,
): Promise<HydratedDocumentEditAnnotation> {
  const edit = await ctx.db.get(snapshot.editId);
  const batch = edit ? await ctx.db.get(edit.batchId) : null;
  const document = edit ? await ctx.db.get(edit.documentId) : null;
  const currentVersion = batch ? await ctx.db.get(batch.currentVersionId) : null;
  if (!edit || !batch || !document || !currentVersion) {
    return {
      ...snapshot,
      displayStatus: "unavailable",
      canUndo: false,
      unavailableReason: "Document edit is no longer available.",
    };
  }
  const isCurrent = document.currentVersionId === batch.currentVersionId;
  const displayStatus = isCurrent ? edit.status : "superseded";
  const canUndo = edit.status !== "pending"
    && edit.preResolutionVersionId !== undefined
    && edit.resolvedVersionId !== undefined
    && edit.resolvedVersionId === batch.currentVersionId
    && document.currentVersionId === batch.currentVersionId;
  return {
    type: "docx_edit_proposed",
    editId: edit._id,
    editBatchId: batch._id,
    generationKey: batch.generationKey,
    documentId: document._id,
    versionId: batch.currentVersionId,
    baseVersionId: batch.baseVersionId,
    introducedVersionId: edit.introducedVersionId,
    preResolutionVersionId: edit.preResolutionVersionId,
    resolvedVersionId: edit.resolvedVersionId,
    generatedFileId: batch.generatedFileId,
    filename: currentVersion.filename,
    versionNumber: currentVersion.versionNumber,
    changeId: edit.changeId,
    deletedText: edit.deletedText,
    insertedText: edit.insertedText,
    contextBefore: edit.contextBefore,
    contextAfter: edit.contextAfter,
    reason: edit.reason,
    status: edit.status,
    displayStatus,
    canUndo,
    resolvedAt: edit.resolvedAt,
  };
}

export async function hydrateDocumentEditAnnotations<T extends { documentEditAnnotations?: HydratedDocumentEditAnnotation[] }>(
  ctx: QueryCtx,
  message: T,
): Promise<T> {
  if (!message.documentEditAnnotations || message.documentEditAnnotations.length === 0) return message;
  return {
    ...message,
    documentEditAnnotations: await Promise.all(
      message.documentEditAnnotations.map((annotation) => hydrateDocumentEditAnnotation(ctx, annotation)),
    ),
  };
}
