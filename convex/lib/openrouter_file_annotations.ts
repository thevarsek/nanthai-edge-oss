import { usageFromUnknown } from "./openrouter_extract";
import type {
  FileAnnotation,
  NonStreamResult,
  PerplexityAnnotation,
} from "./openrouter_types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFileContentPart(
  value: unknown,
): value is FileAnnotation["file"]["content"][number] {
  if (!isRecord(value)) return false;
  if (value.type === "text") return typeof value.text === "string";
  if (value.type !== "image_url" || !isRecord(value.image_url)) return false;
  return typeof value.image_url.url === "string" && value.image_url.url.length > 0;
}

function isFileAnnotation(value: unknown): value is FileAnnotation {
  if (!isRecord(value) || value.type !== "file" || !isRecord(value.file)) {
    return false;
  }
  const file = value.file;
  return (
    typeof file.hash === "string" &&
    file.hash.length > 0 &&
    (file.name === undefined || typeof file.name === "string") &&
    Array.isArray(file.content) &&
    file.content.every(isFileContentPart)
  );
}

function dedupeFileAnnotations(values: unknown): FileAnnotation[] {
  if (!Array.isArray(values)) return [];
  const seenHashes = new Set<string>();
  const annotations: FileAnnotation[] = [];
  for (const value of values) {
    if (!isFileAnnotation(value) || seenHashes.has(value.file.hash)) continue;
    seenHashes.add(value.file.hash);
    annotations.push(value);
  }
  return annotations;
}

function parsePayload(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function extractUrlAnnotationsFromPayload(
  parsed: Record<string, unknown>,
): PerplexityAnnotation[] {
  const choices = parsed.choices as
    | Array<{ message?: { annotations?: unknown[] } }>
    | undefined;
  const rawAnnotations = choices?.[0]?.message?.annotations;
  if (!Array.isArray(rawAnnotations)) return [];

  return rawAnnotations.filter((annotation): annotation is PerplexityAnnotation => {
    if (!annotation || typeof annotation !== "object") return false;
    const data = annotation as Record<string, unknown>;
    const citation = data.url_citation as Record<string, unknown> | undefined;
    return data.type === "url_citation" && typeof citation?.url === "string";
  });
}

export function extractFileAnnotationsFromPayload(
  parsed: Record<string, unknown>,
): FileAnnotation[] {
  const choices = parsed.choices as
    | Array<{ message?: { annotations?: unknown[] } }>
    | undefined;
  return dedupeFileAnnotations(choices?.[0]?.message?.annotations);
}

export function recoverFileAnnotationsFromErrorPayload(
  payload: unknown,
  modelId: string,
): NonStreamResult | null {
  const parsed = parsePayload(payload);
  if (!parsed || !isRecord(parsed.error) || !isRecord(parsed.error.metadata)) {
    return null;
  }
  const fileAnnotations = dedupeFileAnnotations(
    parsed.error.metadata.file_annotations,
  );
  if (fileAnnotations.length === 0) return null;

  return {
    content: "",
    modelId: typeof parsed.model === "string" && parsed.model.trim().length > 0
      ? parsed.model
      : modelId,
    usage: usageFromUnknown(parsed.usage) ?? null,
    finishReason: null,
    audioBase64: "",
    audioTranscript: "",
    generationId:
      typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null,
    annotations: extractUrlAnnotationsFromPayload(parsed),
    fileAnnotations,
  };
}
