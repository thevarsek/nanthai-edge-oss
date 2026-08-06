"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  callOpenRouterNonStreaming,
  type OpenRouterUsage,
} from "../lib/openrouter";
import { MODEL_IDS } from "../lib/model_constants";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { readPdfBlob } from "../runtime/service_pdf";
import type { ToolExecutionContext } from "../tools/registry";
import {
  serializableToolContextValidator,
  type SerializableToolContext,
} from "../tools/proxy_context";
import {
  buildPdfOcrRequest,
  buildPdfOcrRetryConfig,
  canonicalTextFromFileAnnotations,
  PDF_OCR_ENGINE,
  resolvePdfOcrProviderDeadline,
  type PdfOcrAccountingStatus,
  shouldUsePdfOcr,
} from "./pdf_ocr_fallback";
import { recordPdfOcrUsage } from "./pdf_ocr_usage_actions";

export interface ExtractPdfVersionArgs {
  versionId: Id<"documentVersions">;
  storageId: Id<"_storage">;
  filename: string;
  toolContext: SerializableToolContext;
}

export interface PdfExtractionResult {
  text: string;
  markdown: string;
  pageCount: number;
  wordCount: number;
  ocrUsed: boolean;
  extractionMethod: "pypdf" | "mistral_ocr";
  ocrEngine: typeof PDF_OCR_ENGINE | null;
  modelId: string | null;
  usage: OpenRouterUsage | null;
  generationId: string | null;
  ocrAccountingStatus: PdfOcrAccountingStatus;
}

const defaultPdfExtractionDeps = {
  readPdfBlob,
  callOpenRouterNonStreaming,
  getRequiredUserOpenRouterApiKey,
  now: () => Date.now(),
};

export type PdfExtractionDeps = typeof defaultPdfExtractionDeps;

export function createPdfExtractionDepsForTest(
  overrides: Partial<PdfExtractionDeps> = {},
): PdfExtractionDeps {
  return { ...defaultPdfExtractionDeps, ...overrides };
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function pypdfResult(extracted: {
  text: string;
  pageCount: number;
}): PdfExtractionResult {
  return {
    text: extracted.text,
    markdown: extracted.text,
    pageCount: extracted.pageCount,
    wordCount: wordCount(extracted.text),
    ocrUsed: false,
    extractionMethod: "pypdf",
    ocrEngine: null,
    modelId: null,
    usage: null,
    generationId: null,
    ocrAccountingStatus: "not_applicable",
  };
}

function requireOcrTracking(toolContext: SerializableToolContext): {
  chatId: Id<"chats">;
  messageId: Id<"messages">;
} {
  const chatId = toolContext.chatId?.trim();
  const messageId = (toolContext.messageId ?? toolContext.userMessageId)?.trim();
  if (!chatId || !messageId) {
    throw new ConvexError({
      code: "PDF_OCR_TRACKING_REQUIRED" as const,
      message: "Scanned PDF OCR requires a tracked chat and message.",
    });
  }
  return {
    chatId: chatId as Id<"chats">,
    messageId: messageId as Id<"messages">,
  };
}

export async function extractPdfVersionHandler(
  ctx: ActionCtx,
  args: ExtractPdfVersionArgs,
  deps: PdfExtractionDeps = defaultPdfExtractionDeps,
): Promise<PdfExtractionResult> {
  const actionStartedAt = deps.now();
  const version = await ctx.runQuery(
    internal.documents.queries.getVersionForExtraction,
    { versionId: args.versionId },
  );
  if (!version) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: "Document version not found.",
    });
  }
  if (version.userId !== args.toolContext.userId) {
    throw new ConvexError({
      code: "FORBIDDEN" as const,
      message: "You do not have access to this document version.",
    });
  }
  if (version.storageId !== args.storageId) {
    throw new ConvexError({
      code: "VALIDATION_ERROR" as const,
      message: "Document version storage does not match the requested file.",
    });
  }

  const blob = await ctx.storage.get(args.storageId);
  if (!blob) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: "Document bytes not found.",
    });
  }
  const toolCtx: ToolExecutionContext = {
    ctx,
    ...args.toolContext,
  };
  const extracted = await deps.readPdfBlob(toolCtx, blob, version.filename);
  if (!shouldUsePdfOcr(extracted.text)) return pypdfResult(extracted);

  if (args.toolContext.requireZdr === true) {
    throw new ConvexError({
      code: "PDF_OCR_ZDR_UNAVAILABLE" as const,
      message:
        "Scanned PDF OCR is unavailable for Zero Data Retention chats because " +
        "OpenRouter does not document ZDR coverage for file parsing.",
    });
  }

  const tracking = requireOcrTracking(args.toolContext);
  const apiKey = await deps.getRequiredUserOpenRouterApiKey(
    ctx,
    args.toolContext.userId,
  );
  const request = await buildPdfOcrRequest(
    blob,
    version.filename,
  );
  const absoluteDeadlineAtMs = resolvePdfOcrProviderDeadline(
    actionStartedAt,
    args.toolContext.providerDeadlineAtMs,
  );
  const retryConfig = buildPdfOcrRetryConfig(
    absoluteDeadlineAtMs,
    deps.now(),
  );
  const result = await deps.callOpenRouterNonStreaming(
    apiKey,
    MODEL_IDS.pdfOcrExtraction,
    request.messages,
    request.params,
    retryConfig,
  );
  const text = canonicalTextFromFileAnnotations(result.fileAnnotations);
  const modelId = result.modelId?.trim() || MODEL_IDS.pdfOcrExtraction;
  const ocrAccountingStatus = await recordPdfOcrUsage(ctx, {
    versionId: args.versionId,
    storageId: args.storageId,
    userId: args.toolContext.userId,
    ...tracking,
    modelId,
    ocrEngine: PDF_OCR_ENGINE,
  }, result);

  return {
    text,
    markdown: text,
    pageCount: extracted.pageCount,
    wordCount: wordCount(text),
    ocrUsed: true,
    extractionMethod: "mistral_ocr",
    ocrEngine: PDF_OCR_ENGINE,
    modelId,
    usage: result.usage,
    generationId: result.generationId,
    ocrAccountingStatus,
  };
}

export const extractPdfVersion = internalAction({
  args: {
    versionId: v.id("documentVersions"),
    storageId: v.id("_storage"),
    filename: v.string(),
    toolContext: serializableToolContextValidator,
  },
  handler: extractPdfVersionHandler,
});
