"use node";

import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { readPdfBlob } from "../runtime/service_pdf";
import { extractDocxContent } from "./docx_reader";
import { createTool, ToolExecutionContext } from "./registry";
import {
  normalizeWhitespace,
  ScopedDocument,
} from "../documents/shared";

type ExtractionPayload = {
  text: string;
  markdown?: string;
  pageCount?: number;
  wordCount?: number;
};

const DEFAULT_READ_DOCUMENT_CHARS = 60_000;
const MAX_READ_DOCUMENT_CHARS = 120_000;

function clampReadLimit(raw: unknown): number {
  const parsed = Number(raw ?? DEFAULT_READ_DOCUMENT_CHARS);
  if (!Number.isFinite(parsed)) return DEFAULT_READ_DOCUMENT_CHARS;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_READ_DOCUMENT_CHARS);
}

function clampReadOffset(raw: unknown): number {
  const parsed = Number(raw ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(Math.floor(parsed), 0);
}

function sliceDocumentContent(
  content: string,
  startChar: number,
  maxChars: number,
): {
  content: string;
  startChar: number;
  maxChars: number;
  returnedCharCount: number;
  totalCharCount: number;
  isTruncated: boolean;
  nextStartChar?: number;
} {
  const boundedStart = Math.min(startChar, content.length);
  const end = Math.min(boundedStart + maxChars, content.length);
  return {
    content: content.slice(boundedStart, end),
    startChar: boundedStart,
    maxChars,
    returnedCharCount: end - boundedStart,
    totalCharCount: content.length,
    isTruncated: end < content.length,
    nextStartChar: end < content.length ? end : undefined,
  };
}

async function scopedDocuments(toolCtx: ToolExecutionContext): Promise<ScopedDocument[]> {
  if (!toolCtx.chatId) return [];
  return await toolCtx.ctx.runMutation(
    internal.documents.mutations.ensureDocumentsForChat,
    {
      userId: toolCtx.userId,
      chatId: toolCtx.chatId as Id<"chats">,
    },
  ) as ScopedDocument[];
}

function resolveScopedDocument(
  docs: ScopedDocument[],
  raw: unknown,
): ScopedDocument | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  return docs.find((doc) =>
    doc.ref === value ||
    doc.documentId === value ||
    doc.versionId === value ||
    doc.storageId === value ||
    doc.driveFileId === value ||
    doc.filename.toLowerCase() === value.toLowerCase()
  ) ?? null;
}

async function extractVersion(
  toolCtx: ToolExecutionContext,
  doc: ScopedDocument,
): Promise<ExtractionPayload> {
  if (!doc.versionId) {
    throw new Error("Document has no current version.");
  }
  const version = await toolCtx.ctx.runQuery(
    internal.documents.queries.getVersionForExtraction,
    { versionId: doc.versionId },
  );
  if (!version) {
    throw new Error("Document version not found.");
  }

  if (version.extractionStatus === "ready" && version.extractionTextStorageId) {
    const textBlob = await toolCtx.ctx.storage.get(version.extractionTextStorageId);
    const markdownBlob = version.extractionMarkdownStorageId
      ? await toolCtx.ctx.storage.get(version.extractionMarkdownStorageId)
      : null;
    if (textBlob) {
      return {
        text: await textBlob.text(),
        markdown: markdownBlob ? await markdownBlob.text() : undefined,
        pageCount: version.pageCount,
        wordCount: version.wordCount,
      };
    }
  }

  await toolCtx.ctx.runMutation(internal.documents.mutations.updateVersionExtraction, {
    versionId: doc.versionId,
    status: "extracting",
  });

  let unsupported = false;
  try {
    const mime = version.mimeType.toLowerCase();
    const filename = version.filename.toLowerCase();
    let payload: ExtractionPayload;

    if (mime === "application/pdf" || filename.endsWith(".pdf")) {
      const blob = await toolCtx.ctx.storage.get(version.storageId);
      if (!blob) throw new Error("Document bytes not found.");
      const pdf = await readPdfBlob(toolCtx, blob, version.filename);
      payload = {
        text: pdf.text,
        markdown: pdf.text,
        pageCount: pdf.pageCount,
        wordCount: pdf.text.split(/\s+/).filter(Boolean).length,
      };
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.endsWith(".docx")
    ) {
      const blob = await toolCtx.ctx.storage.get(version.storageId);
      if (!blob) throw new Error("Document bytes not found.");
      const extracted = await extractDocxContent(await blob.arrayBuffer());
      payload = {
        text: extracted.text,
        markdown: extracted.markdown,
        wordCount: extracted.wordCount,
      };
    } else if (mime.startsWith("text/") || filename.endsWith(".csv") || filename.endsWith(".json")) {
      const blob = await toolCtx.ctx.storage.get(version.storageId);
      if (!blob) throw new Error("Document bytes not found.");
      const text = await blob.text();
      payload = {
        text,
        markdown: text,
        wordCount: text.split(/\s+/).filter(Boolean).length,
      };
    } else {
      unsupported = true;
      throw new Error(`Unsupported readable document type: ${version.mimeType}`);
    }

    const textStorageId = await toolCtx.ctx.storage.store(
      new Blob([payload.text], { type: "text/plain;charset=utf-8" }),
    );
    const markdownStorageId = payload.markdown
      ? await toolCtx.ctx.storage.store(
        new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" }),
      )
      : undefined;

    await toolCtx.ctx.runMutation(internal.documents.mutations.updateVersionExtraction, {
      versionId: doc.versionId,
      status: "ready",
      extractionTextStorageId: textStorageId as Id<"_storage">,
      extractionMarkdownStorageId: markdownStorageId as Id<"_storage"> | undefined,
      extractionByteLength: new TextEncoder().encode(payload.text).byteLength,
      pageCount: payload.pageCount,
      wordCount: payload.wordCount,
    });

    return payload;
  } catch (error) {
    await toolCtx.ctx.runMutation(internal.documents.mutations.updateVersionExtraction, {
      versionId: doc.versionId,
      status: unsupported ? "unsupported" : "error",
      extractionError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export const listDocuments = createTool({
  name: "list_documents",
  description:
    "List readable documents explicitly scoped to this chat. This only includes files attached or selected for the current chat context, not the user's whole Knowledge Base.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  execute: async (toolCtx) => {
    const docs = await scopedDocuments(toolCtx);
    return {
      success: true,
      data: {
        documents: docs.map((doc) => ({
          doc_id: doc.ref,
          documentId: doc.documentId,
          versionId: doc.versionId,
          filename: doc.filename,
          mimeType: doc.mimeType,
          source: doc.source,
          versionNumber: doc.versionNumber,
          extractionStatus: doc.extractionStatus,
          syncState: doc.syncState,
          driveFileId: doc.driveFileId,
        })),
      },
    };
  },
});

export const readDocument = createTool({
  name: "read_document",
  description:
    "Read extracted text or markdown for a scoped document. Results are windowed to protect the model context; use start_char and max_chars to continue reading longer documents, or find_in_document for targeted search. Use doc_id values from list_documents, such as doc-0.",
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string", description: "Scoped document handle, document ID, version ID, storage ID, or exact filename." },
      format: { type: "string", description: "Optional: 'text' or 'markdown'. Defaults to markdown when available." },
      start_char: { type: "integer", description: "Zero-based character offset to start reading from. Defaults to 0." },
      max_chars: { type: "integer", description: `Maximum characters to return. Defaults to ${DEFAULT_READ_DOCUMENT_CHARS}; capped at ${MAX_READ_DOCUMENT_CHARS}.` },
    },
    required: ["doc_id"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    try {
      const docs = await scopedDocuments(toolCtx);
      const doc = resolveScopedDocument(docs, args.doc_id);
      if (!doc) {
        return { success: false, data: null, error: "Document is not in the current chat scope." };
      }
      const extraction = await extractVersion(toolCtx, doc);
      const preferText = String(args.format ?? "").toLowerCase() === "text";
      const fullContent = preferText ? extraction.text : extraction.markdown ?? extraction.text;
      const windowed = sliceDocumentContent(
        fullContent,
        clampReadOffset(args.start_char),
        clampReadLimit(args.max_chars),
      );
      return {
        success: true,
        data: {
          doc_id: doc.ref,
          documentId: doc.documentId,
          versionId: doc.versionId,
          filename: doc.filename,
          versionNumber: doc.versionNumber,
          content: windowed.content,
          charCount: extraction.text.length,
          returnedCharCount: windowed.returnedCharCount,
          totalCharCount: windowed.totalCharCount,
          startChar: windowed.startChar,
          maxChars: windowed.maxChars,
          isTruncated: windowed.isTruncated,
          nextStartChar: windowed.nextStartChar,
          pageCount: extraction.pageCount,
          wordCount: extraction.wordCount,
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

export const findInDocument = createTool({
  name: "find_in_document",
  description:
    "Search within a scoped document and return matching excerpts with surrounding context. Matching is case-insensitive and whitespace-tolerant.",
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string", description: "Scoped document handle, such as doc-0." },
      query: { type: "string", description: "Text to search for." },
      max_results: { type: "integer", description: "Maximum matches to return. Defaults to 20." },
      context_chars: { type: "integer", description: "Characters of context before and after each match. Defaults to 160." },
    },
    required: ["doc_id", "query"],
    additionalProperties: false,
  },
  execute: async (toolCtx, args) => {
    try {
      const docs = await scopedDocuments(toolCtx);
      const doc = resolveScopedDocument(docs, args.doc_id);
      if (!doc) {
        return { success: false, data: null, error: "Document is not in the current chat scope." };
      }
      const query = normalizeWhitespace(String(args.query ?? ""));
      if (!query) {
        return { success: false, data: null, error: "Missing query." };
      }
      const maxResults = Math.min(Math.max(Number(args.max_results ?? 20), 1), 50);
      const contextChars = Math.min(Math.max(Number(args.context_chars ?? 160), 20), 1000);
      const extraction = await extractVersion(toolCtx, doc);
      const normalizedText = normalizeWhitespace(extraction.text);
      const lowerText = normalizedText.toLowerCase();
      const lowerQuery = query.toLowerCase();
      const matches: Array<{ index: number; excerpt: string }> = [];
      let index = 0;
      while (matches.length < maxResults) {
        const found = lowerText.indexOf(lowerQuery, index);
        if (found < 0) break;
        const start = Math.max(0, found - contextChars);
        const end = Math.min(normalizedText.length, found + query.length + contextChars);
        matches.push({
          index: found,
          excerpt: normalizedText.slice(start, end),
        });
        index = found + lowerQuery.length;
      }
      return {
        success: true,
        data: {
          doc_id: doc.ref,
          documentId: doc.documentId,
          versionId: doc.versionId,
          filename: doc.filename,
          query,
          totalReturned: matches.length,
          matches,
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});
