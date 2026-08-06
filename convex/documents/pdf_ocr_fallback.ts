import { ConvexError } from "convex/values";
import type {
  ChatRequestParameters,
  OpenRouterMessage,
  OpenRouterUsage,
  RetryConfig,
} from "../lib/openrouter";

export const PDF_OCR_ENGINE = "mistral-ocr" as const;
export const PDF_OCR_MAX_MS = 3 * 60 * 1000;
export const PDF_OCR_PROVIDER_DEADLINE_MS = 8 * 60 * 1000;
export const PDF_OCR_MIN_REMAINING_MS = 30 * 1000;
export const PDF_OCR_POST_TOOL_RESERVE_MS = 60 * 1000;

export type PdfOcrAccountingStatus =
  | "not_applicable"
  | "recorded"
  | "authoritative_cost_required"
  | "usage_unavailable"
  | "record_scheduled"
  | "record_failed";

function invalidOcrResponse(message: string): ConvexError<{
  code: "PDF_OCR_INVALID_RESPONSE";
  message: string;
}> {
  return new ConvexError({
    code: "PDF_OCR_INVALID_RESPONSE",
    message,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function shouldUsePdfOcr(text: string): boolean {
  return text.trim().length === 0;
}

export function canonicalTextFromFileAnnotations(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidOcrResponse(
      "OpenRouter parsed the PDF but returned no file annotations.",
    );
  }

  const textParts: string[] = [];
  for (const annotation of value) {
    if (!isRecord(annotation) || annotation.type !== "file") {
      throw invalidOcrResponse("OpenRouter returned a malformed PDF file annotation.");
    }
    const file = annotation.file;
    if (
      !isRecord(file) ||
      typeof file.hash !== "string" ||
      file.hash.length === 0 ||
      !Array.isArray(file.content)
    ) {
      throw invalidOcrResponse("OpenRouter returned a malformed PDF file annotation.");
    }

    for (const part of file.content) {
      if (!isRecord(part)) {
        throw invalidOcrResponse("OpenRouter returned malformed PDF annotation content.");
      }
      if (part.type === "text") {
        if (typeof part.text !== "string") {
          throw invalidOcrResponse("OpenRouter returned malformed PDF annotation text.");
        }
        if (part.text.trim().length > 0) textParts.push(part.text);
        continue;
      }
      if (
        part.type !== "image_url" ||
        !isRecord(part.image_url) ||
        typeof part.image_url.url !== "string" ||
        part.image_url.url.length === 0
      ) {
        throw invalidOcrResponse("OpenRouter returned malformed PDF annotation content.");
      }
    }
  }

  // A structurally valid annotation with no text is a canonical blank result.
  // Cache it as Mistral OCR output so a genuinely blank scanned PDF is not
  // charged again on every read.
  return textParts.join("\n\n").trim();
}

export async function buildPdfOcrRequest(
  blob: Blob,
  filename: string,
): Promise<{
  messages: OpenRouterMessage[];
  params: ChatRequestParameters;
}> {
  const encoded = Buffer.from(await blob.arrayBuffer()).toString("base64");
  return {
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Parse this PDF. Reply with OK." },
          {
            type: "file",
            file: {
              filename,
              file_data: `data:application/pdf;base64,${encoded}`,
            },
          },
        ],
      },
    ],
    params: {
      maxTokens: 4,
      plugins: [{ id: "file-parser", pdf: { engine: PDF_OCR_ENGINE } }],
    },
  };
}

export function resolvePdfOcrProviderDeadline(
  actionStartedAt: number,
  parentProviderDeadlineAtMs?: number,
): number {
  const actionDeadline = actionStartedAt + PDF_OCR_PROVIDER_DEADLINE_MS;
  return parentProviderDeadlineAtMs !== undefined &&
      Number.isFinite(parentProviderDeadlineAtMs)
    ? Math.min(actionDeadline, parentProviderDeadlineAtMs)
    : actionDeadline;
}

export function buildPdfOcrRetryConfig(
  absoluteDeadlineAtMs: number,
  now: number,
): RetryConfig {
  const remainingMs = absoluteDeadlineAtMs - now;
  const ocrBudgetMs = remainingMs - PDF_OCR_POST_TOOL_RESERVE_MS;
  if (ocrBudgetMs <= PDF_OCR_MIN_REMAINING_MS) {
    throw new ConvexError({
      code: "PDF_OCR_DEADLINE_EXHAUSTED" as const,
      message:
        "Not enough provider time remains to OCR this scanned PDF and finish the response safely.",
    });
  }
  const timeoutMs = Math.min(PDF_OCR_MAX_MS, ocrBudgetMs);
  return {
    retryOnUnsupportedParam: false,
    recoverFileAnnotationsOnError: true,
    requestTimeoutMs: timeoutMs,
    totalTimeoutMs: timeoutMs,
    absoluteDeadlineAtMs,
  };
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function hasValidUsage(
  usage: OpenRouterUsage | null,
): usage is OpenRouterUsage {
  return usage !== null &&
    finiteNonNegative(usage.promptTokens) &&
    finiteNonNegative(usage.completionTokens) &&
    finiteNonNegative(usage.totalTokens);
}

export function hasExactUsageCost(
  usage: OpenRouterUsage,
): usage is OpenRouterUsage & { cost: number } {
  return finiteNonNegative(usage.cost);
}

export function optionalUsageDetails(
  usage: OpenRouterUsage,
): Record<string, number | boolean> {
  const details: Record<string, number | boolean> = {};
  const entries: Array<[string, number | boolean | undefined]> = [
    ["isByok", usage.isByok],
    ["cachedTokens", usage.cachedTokens],
    ["cacheWriteTokens", usage.cacheWriteTokens],
    ["audioPromptTokens", usage.audioPromptTokens],
    ["videoTokens", usage.videoTokens],
    ["reasoningTokens", usage.reasoningTokens],
    ["imageCompletionTokens", usage.imageCompletionTokens],
    ["audioCompletionTokens", usage.audioCompletionTokens],
    ["upstreamInferenceCost", usage.upstreamInferenceCost],
    ["upstreamInferencePromptCost", usage.upstreamInferencePromptCost],
    ["upstreamInferenceCompletionsCost", usage.upstreamInferenceCompletionsCost],
    ["cacheDiscount", usage.cacheDiscount],
    ["webSearchRequests", usage.webSearchRequests],
  ];
  for (const [key, detail] of entries) {
    if (detail !== undefined) details[key] = detail;
  }
  return details;
}
