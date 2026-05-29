"use node";

import { ConvexError, v } from "convex/values";
import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { extractReviewDocxParagraphs, resolveTrackedDocxChange } from "./docx_tracked_changes";

type DocumentEditResolutionTarget =
  | null
  | {
    alreadyResolved: true;
    status: string;
    batchId: Id<"documentEditBatches">;
    currentVersionId: Id<"documentVersions">;
    resolvedVersionId?: Id<"documentVersions">;
    preResolutionVersionId?: Id<"documentVersions">;
    generatedFileId?: Id<"generatedFiles">;
    remainingPending: number;
  }
  | {
    superseded: true;
    status: string;
    batchId: Id<"documentEditBatches">;
  }
  | {
    alreadyResolved: false;
    status: string;
    batchId: Id<"documentEditBatches">;
    currentVersionId: Id<"documentVersions">;
    storageId: Id<"_storage">;
    filename: string;
    mimeType: string;
    changeIds: string[];
    remainingPending: number;
  };

export const resolveDocumentEdit = action({
  args: {
    documentId: v.id("documents"),
    editId: v.id("documentEdits"),
    decision: v.union(v.literal("accept"), v.literal("reject")),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const { userId } = await requireAuth(ctx);
    const target = await ctx.runQuery(internal.documents.queries.getDocumentEditResolutionTarget, {
      userId,
      documentId: args.documentId,
      editId: args.editId,
    }) as DocumentEditResolutionTarget;
    if (!target) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document edit not found or unauthorized." });
    }
    if ("superseded" in target && target.superseded) {
      throw new ConvexError({ code: "SUPERSEDED_VERSION", message: "This edit batch is no longer the current document version." });
    }
    if ("alreadyResolved" in target && target.alreadyResolved) {
      return {
        ok: true,
        editId: args.editId,
        status: target.status,
        alreadyResolved: true,
        documentId: args.documentId,
        versionId: target.resolvedVersionId ?? target.currentVersionId,
        previousVersionId: target.preResolutionVersionId ?? target.currentVersionId,
        generatedFileId: target.generatedFileId ?? null,
        remainingPending: target.remainingPending ?? 0,
        downloadUrl: null,
      };
    }
    if (!("alreadyResolved" in target) || target.alreadyResolved !== false) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Current document version not found." });
    }
    const blob = await ctx.storage.get(target.storageId);
    if (!blob) throw new ConvexError({ code: "NOT_FOUND", message: "Current document bytes not found." });
    const resolved = await resolveTrackedDocxChange(await blob.arrayBuffer(), target.changeIds, args.decision);
    if (!resolved.found) {
      throw new ConvexError({
        code: "TRACKED_CHANGE_NOT_FOUND",
        message: "Tracked-change markup for this edit is no longer present in the current document version.",
      });
    }
    const storageId = await ctx.storage.store(new Blob([resolved.bytes], { type: target.mimeType }));
    return await ctx.runMutation(internal.documents.mutations.commitResolvedDocumentEdit, {
      userId,
      documentId: args.documentId,
      editId: args.editId,
      decision: args.decision,
      previousVersionId: target.currentVersionId,
      storageId,
      filename: target.filename,
      mimeType: target.mimeType,
      sizeBytes: resolved.bytes.byteLength,
    });
  },
});

export const getDocumentPreview = action({
  args: {
    versionId: v.id("documentVersions"),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const { userId } = await requireAuth(ctx);
    const version = await ctx.runQuery(internal.documents.queries.getVersionForExtraction, {
      versionId: args.versionId,
    });
    if (!version || version.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Document version not found or unauthorized." });
    }
    const blob = await ctx.storage.get(version.storageId);
    if (!blob) throw new ConvexError({ code: "NOT_FOUND", message: "Document bytes not found." });

    const filename = version.filename.toLowerCase();
    const mimeType = version.mimeType.toLowerCase();
    if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.endsWith(".docx")
    ) {
      const preview = await extractReviewDocxParagraphs(await blob.arrayBuffer());
      return {
        kind: "docx",
        versionId: version._id,
        filename: version.filename,
        mimeType: version.mimeType,
        paragraphs: preview.paragraphs,
        wordCount: preview.wordCount,
      };
    }

    if (mimeType.startsWith("text/") || filename.endsWith(".txt") || filename.endsWith(".md")) {
      const text = await blob.text();
      return {
        kind: "text",
        versionId: version._id,
        filename: version.filename,
        mimeType: version.mimeType,
        paragraphs: text.split(/\n{2,}/).map((paragraph) => ({
          style: "Normal",
          segments: [{ kind: "normal", text: paragraph }],
        })),
        wordCount: text.split(/\s+/).filter(Boolean).length,
      };
    }

    return {
      kind: "unsupported",
      versionId: version._id,
      filename: version.filename,
      mimeType: version.mimeType,
      paragraphs: [],
      wordCount: version.wordCount,
    };
  },
});
