"use node";

import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { createTool } from "./registry";
import { resolveScopedDocument, scopedDocuments } from "./document_workspace";
import { applyTrackedDocxEdits, ProposedDocxEdit } from "../documents/docx_tracked_changes";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_EDITS_PER_CALL = 25;
const MAX_EDITS_PER_TURN = 100;
const MAX_ANCHOR_CHARS = 4_000;

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseEdits(raw: unknown): { edits: ProposedDocxEdit[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { edits: [], error: "At least one edit is required." };
  if (raw.length > MAX_EDITS_PER_CALL) return { edits: [], error: `At most ${MAX_EDITS_PER_CALL} edits are allowed per call.` };
  const edits: ProposedDocxEdit[] = [];
  for (const candidate of raw) {
    const row = candidate as Record<string, unknown>;
    const edit = {
      find: stringField(row.find),
      replace: stringField(row.replace),
      contextBefore: stringField(row.context_before ?? row.contextBefore),
      contextAfter: stringField(row.context_after ?? row.contextAfter),
      reason: stringField(row.reason) || undefined,
    };
    if ([edit.find, edit.replace, edit.contextBefore, edit.contextAfter, edit.reason ?? ""].some((field) => field.length > MAX_ANCHOR_CHARS)) {
      return { edits: [], error: `Edit anchors, replacement text, and reasons must be at most ${MAX_ANCHOR_CHARS} characters.` };
    }
    edits.push(edit);
  }
  return { edits };
}

export const proposeDocxEdits = createTool({
  name: "propose_docx_edits",
  description:
    "Propose precise edits to a scoped Microsoft Word .docx as Word tracked changes. Use read_document first. Each edit should be a minimal substitution with short copied context anchors.",
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string", description: "Scoped document handle, document ID, version ID, storage ID, or exact filename." },
      edits: {
        type: "array",
        description: "Minimal anchored replacements to propose as tracked changes.",
        items: {
          type: "object",
          properties: {
            find: { type: "string" },
            replace: { type: "string" },
            context_before: { type: "string" },
            context_after: { type: "string" },
            reason: { type: "string" },
          },
          required: ["find", "replace"],
          additionalProperties: false,
        },
      },
    },
    required: ["doc_id", "edits"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    try {
      const docs = await scopedDocuments(toolCtx);
      const doc = resolveScopedDocument(docs, args.doc_id);
      if (!doc || !doc.versionId) {
        return { success: false, data: null, error: "Document is not in the current chat scope." };
      }
      const isDocx = doc.mimeType === DOCX_MIME || doc.filename.toLowerCase().endsWith(".docx");
      if (!isDocx) return { success: false, data: null, error: "UNSUPPORTED_DOCX: propose_docx_edits only supports .docx files." };
      const parsed = parseEdits(args.edits);
      if (parsed.error) return { success: false, data: null, error: parsed.error };
      const generationKey = toolCtx.generationKey ?? toolCtx.jobId ?? toolCtx.messageId ?? `${toolCtx.chatId ?? "chat"}:${doc.documentId}`;
      const batchUsage = await toolCtx.ctx.runQuery(internal.documents.queries.getDocumentEditBatchUsage, {
        userId: toolCtx.userId,
        generationKey,
        documentId: doc.documentId,
      });
      if ((batchUsage.editCount ?? 0) + parsed.edits.length > MAX_EDITS_PER_TURN) {
        return {
          success: false,
          data: null,
          error: `At most ${MAX_EDITS_PER_TURN} DOCX tracked-change edits are allowed per assistant turn for one document.`,
        };
      }
      const blob = await toolCtx.ctx.storage.get(doc.storageId as Id<"_storage">);
      if (!blob) return { success: false, data: null, error: "Document bytes were not found." };
      const result = await applyTrackedDocxEdits(await blob.arrayBuffer(), parsed.edits, {
        author: "NanthAI",
        seed: `${generationKey}:${doc.documentId}:${doc.versionId}`,
      });
      if (result.changes.length === 0) {
        return {
          success: false,
          data: { errors: result.errors },
          error: result.errors[0]?.message ?? "No proposed edits could be applied.",
        };
      }
      const storageId = await toolCtx.ctx.storage.store(new Blob([result.bytes], { type: DOCX_MIME }));
      const sizeBytes = result.bytes.byteLength;
      let committed;
      try {
        committed = await toolCtx.ctx.runMutation(internal.documents.mutations.commitProposedDocxEdits, {
          userId: toolCtx.userId,
          chatId: toolCtx.chatId as Id<"chats"> | undefined,
          messageId: toolCtx.messageId as Id<"messages"> | undefined,
          generationKey,
          documentId: doc.documentId,
          sourceVersionId: doc.versionId,
          storageId,
          filename: doc.filename,
          mimeType: DOCX_MIME,
          sizeBytes,
          changes: result.changes,
        });
      } catch (error) {
        await toolCtx.ctx.storage.delete(storageId).catch(() => undefined);
        throw error;
      }
      return {
        success: true,
        data: {
          ok: true,
          doc_id: doc.ref,
          documentId: doc.documentId,
          versionId: committed.versionId,
          storageId,
          generatedFileId: committed.generatedFileId,
          filename: doc.filename,
          mimeType: DOCX_MIME,
          sizeBytes,
          applied: result.changes.length,
          errors: result.errors,
          editBatchId: committed.batchId,
          editIds: committed.annotations.map((annotation: { editId: string }) => annotation.editId),
          annotations: committed.annotations,
          documentEvent: {
            type: "document_updated",
            documentId: doc.documentId,
            versionId: committed.versionId,
            storageId,
            generatedFileId: committed.generatedFileId,
            filename: doc.filename,
            mimeType: DOCX_MIME,
            sizeBytes,
            title: doc.title,
          },
        },
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
