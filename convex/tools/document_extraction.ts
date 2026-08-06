import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { SerializableToolContext } from "./proxy_context";
import { serializableToolContext } from "./proxy_context";
import type { ToolExecutionContext } from "./registry";
import type { ScopedDocument } from "../documents/shared";
import { extractDocxContent } from "./docx_reader";

export type ExtractionPayload = {
  text: string;
  markdown?: string;
  pageCount?: number;
  wordCount?: number;
  extractionMethod?: "pypdf" | "mistral_ocr";
};
type ExtractPdfVersionArgs = {
  versionId: Id<"documentVersions">;
  storageId: Id<"_storage">;
  filename: string;
  toolContext: SerializableToolContext;
};
type ClaimVersionExtractionArgs = {
  versionId: Id<"documentVersions">;
  userId: string;
  leaseOwner: string;
  now: number;
  leaseExpiresAt: number;
  allowReadyReclaim?: boolean;
};
type ClaimVersionExtractionResult =
  | { state: "claimed" }
  | { state: "ready" }
  | { state: "busy"; leaseExpiresAt: number };

type UpdateVersionExtractionArgs = {
  versionId: Id<"documentVersions">;
  leaseOwner: string;
  status: "ready" | "error" | "unsupported";
  extractionMethod?: "pypdf" | "mistral_ocr";
  extractionTextStorageId?: Id<"_storage">;
  extractionMarkdownStorageId?: Id<"_storage">;
  extractionByteLength?: number;
  extractionError?: string;
  pageCount?: number;
  wordCount?: number;
};

type ExtractableVersion = {
  _id: Id<"documentVersions">;
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  extractionStatus: string;
  extractionMethod?: "pypdf" | "mistral_ocr";
  extractionTextStorageId?: Id<"_storage">;
  extractionMarkdownStorageId?: Id<"_storage">;
  pageCount?: number;
  wordCount?: number;
};

const EXTRACTION_LEASE_MS = 9 * 60 * 1_000;

const extractPdfVersionRef = makeFunctionReference<
  "action",
  ExtractPdfVersionArgs,
  ExtractionPayload
>("documents/pdf_extraction_actions:extractPdfVersion") as unknown as FunctionReference<
  "action",
  "internal",
  ExtractPdfVersionArgs,
  ExtractionPayload
>;

const claimVersionExtractionRef = makeFunctionReference<
  "mutation",
  ClaimVersionExtractionArgs,
  ClaimVersionExtractionResult
>("documents/extraction_mutations:claimVersionExtraction") as unknown as FunctionReference<
  "mutation",
  "internal",
  ClaimVersionExtractionArgs,
  ClaimVersionExtractionResult
>;

const updateVersionExtractionRef = makeFunctionReference<
  "mutation",
  UpdateVersionExtractionArgs,
  boolean
>("documents/extraction_mutations:updateVersionExtraction") as unknown as FunctionReference<
  "mutation",
  "internal",
  UpdateVersionExtractionArgs,
  boolean
>;

function isPdf(version: ExtractableVersion): boolean {
  return version.mimeType.toLowerCase() === "application/pdf"
    || version.filename.toLowerCase().endsWith(".pdf");
}

async function readCachedExtraction(
  toolCtx: ToolExecutionContext,
  version: ExtractableVersion,
): Promise<ExtractionPayload | null> {
  if (version.extractionStatus !== "ready" || !version.extractionTextStorageId) {
    return null;
  }
  const textBlob = await toolCtx.ctx.storage.get(version.extractionTextStorageId);
  if (!textBlob) return null;
  const text = await textBlob.text();
  if (
    isPdf(version)
    && text.trim().length === 0
    && version.extractionMethod !== "mistral_ocr"
  ) {
    return null;
  }
  const markdownBlob = version.extractionMarkdownStorageId
    ? await toolCtx.ctx.storage.get(version.extractionMarkdownStorageId)
    : null;
  return {
    text,
    markdown: markdownBlob ? await markdownBlob.text() : undefined,
    pageCount: version.pageCount,
    wordCount: version.wordCount,
    extractionMethod: version.extractionMethod,
  };
}

async function getVersion(
  toolCtx: ToolExecutionContext,
  versionId: Id<"documentVersions">,
): Promise<ExtractableVersion> {
  const version = await toolCtx.ctx.runQuery(
    internal.documents.queries.getVersionForExtraction,
    { versionId },
  );
  if (!version || version.userId !== toolCtx.userId) {
    throw new Error("Document version not found.");
  }
  return version;
}

async function deleteUncommittedExtractionBlobs(
  toolCtx: ToolExecutionContext,
  storageIds: Id<"_storage">[],
): Promise<void> {
  await Promise.all(storageIds.map(async (storageId) => {
    try {
      await toolCtx.ctx.storage.delete(storageId);
    } catch (error) {
      console.warn("[documents:extraction] failed to delete uncommitted blob", {
        storageId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }));
}

async function claimExtraction(
  toolCtx: ToolExecutionContext,
  versionId: Id<"documentVersions">,
  leaseOwner: string,
  allowReadyReclaim = false,
): Promise<ClaimVersionExtractionResult> {
  const now = Date.now();
  return await toolCtx.ctx.runMutation(claimVersionExtractionRef, {
    versionId,
    userId: toolCtx.userId,
    leaseOwner,
    now,
    leaseExpiresAt: now + EXTRACTION_LEASE_MS,
    ...(allowReadyReclaim ? { allowReadyReclaim: true } : {}),
  });
}

async function extractUncachedVersion(
  toolCtx: ToolExecutionContext,
  version: ExtractableVersion,
): Promise<ExtractionPayload> {
  if (isPdf(version)) {
    const payload = await toolCtx.ctx.runAction(extractPdfVersionRef, {
      versionId: version._id,
      storageId: version.storageId,
      filename: version.filename,
      toolContext: serializableToolContext(toolCtx),
    });
    return {
      ...payload,
      extractionMethod: payload.extractionMethod ?? "pypdf",
    };
  }
  const mime = version.mimeType.toLowerCase();
  const filename = version.filename.toLowerCase();
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || filename.endsWith(".docx")
  ) {
    const blob = await toolCtx.ctx.storage.get(version.storageId);
    if (!blob) throw new Error("Document bytes not found.");
    const extracted = await extractDocxContent(await blob.arrayBuffer());
    return {
      text: extracted.text,
      markdown: extracted.markdown,
      wordCount: extracted.wordCount,
    };
  }
  if (mime.startsWith("text/") || filename.endsWith(".csv") || filename.endsWith(".json")) {
    const blob = await toolCtx.ctx.storage.get(version.storageId);
    if (!blob) throw new Error("Document bytes not found.");
    const text = await blob.text();
    return {
      text,
      markdown: text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }
  throw new Error(`Unsupported readable document type: ${version.mimeType}`);
}

export async function extractVersion(
  toolCtx: ToolExecutionContext,
  doc: ScopedDocument,
): Promise<ExtractionPayload> {
  if (!doc.versionId) throw new Error("Document has no current version.");
  let version = await getVersion(toolCtx, doc.versionId);
  const cached = await readCachedExtraction(toolCtx, version);
  if (cached) return cached;

  const leaseOwner = toolCtx.operationIdempotencyKey ?? crypto.randomUUID();
  let claim = await claimExtraction(toolCtx, doc.versionId, leaseOwner);
  if (claim.state === "ready") {
    version = await getVersion(toolCtx, doc.versionId);
    const racedCache = await readCachedExtraction(toolCtx, version);
    if (racedCache) return racedCache;
    claim = await claimExtraction(toolCtx, doc.versionId, leaseOwner, true);
  }
  if (claim.state === "busy") {
    throw new Error("Document extraction is already in progress. Please retry shortly.");
  }

  const unsupported = !isPdf(version)
    && !version.mimeType.toLowerCase().startsWith("text/")
    && !version.filename.toLowerCase().endsWith(".csv")
    && !version.filename.toLowerCase().endsWith(".json")
    && version.mimeType.toLowerCase()
      !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    && !version.filename.toLowerCase().endsWith(".docx");
  let uncommittedStorageIds: Id<"_storage">[] = [];
  try {
    const payload = await extractUncachedVersion(toolCtx, version);
    const textStorageId = await toolCtx.ctx.storage.store(
      new Blob([payload.text], { type: "text/plain;charset=utf-8" }),
    );
    uncommittedStorageIds.push(textStorageId as Id<"_storage">);
    const markdownStorageId = payload.markdown
      ? await toolCtx.ctx.storage.store(
          new Blob([payload.markdown], { type: "text/markdown;charset=utf-8" }),
        )
      : undefined;
    if (markdownStorageId) {
      uncommittedStorageIds.push(markdownStorageId as Id<"_storage">);
    }
    const committed = await toolCtx.ctx.runMutation(updateVersionExtractionRef, {
      versionId: doc.versionId,
      leaseOwner,
      status: "ready",
      extractionMethod: payload.extractionMethod,
      extractionTextStorageId: textStorageId as Id<"_storage">,
      extractionMarkdownStorageId: markdownStorageId as Id<"_storage"> | undefined,
      extractionByteLength: new TextEncoder().encode(payload.text).byteLength,
      pageCount: payload.pageCount,
      wordCount: payload.wordCount,
    });
    if (!committed) {
      await deleteUncommittedExtractionBlobs(toolCtx, uncommittedStorageIds);
      uncommittedStorageIds = [];
      const current = await getVersion(toolCtx, doc.versionId);
      const currentCache = await readCachedExtraction(toolCtx, current);
      if (currentCache) return currentCache;
      throw new Error("Document extraction was superseded before it could be cached.");
    }
    uncommittedStorageIds = [];
    return payload;
  } catch (error) {
    await deleteUncommittedExtractionBlobs(toolCtx, uncommittedStorageIds);
    await toolCtx.ctx.runMutation(updateVersionExtractionRef, {
      versionId: doc.versionId,
      leaseOwner,
      status: unsupported ? "unsupported" : "error",
      extractionError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
