import type { StoredFileEntry } from "../runtime/service_analytics_common";
import { ANALYTICS_PARENT_RESULT_MAX_BYTES } from "./limits";

const encoder = new TextEncoder();

export interface ParentResultInput {
  text: string;
  resultsSummary: string[];
  importedFiles: unknown[];
  exportedFiles: StoredFileEntry[];
  warnings: string[];
}

export interface NormalizedParentResult {
  resultJson: string;
  resultBytes: number;
  overflowJson?: string;
}

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function truncateUtf8(value: string, maximumBytes: number): string {
  if (maximumBytes <= 0) return "";
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  let end = maximumBytes;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.slice(0, end));
}

function resultPayload(input: ParentResultInput) {
  return {
    text: input.text,
    resultsSummary: input.resultsSummary,
    importedFiles: input.importedFiles,
    exportedFiles: input.exportedFiles,
    chartsCreated: [],
    warnings: input.warnings,
  };
}

export function buildInlineParentResult(input: ParentResultInput): NormalizedParentResult {
  const resultJson = JSON.stringify(resultPayload(input));
  const resultBytes = utf8ByteLength(resultJson);
  if (resultBytes <= ANALYTICS_PARENT_RESULT_MAX_BYTES) {
    return { resultJson, resultBytes };
  }
  return {
    resultJson: "",
    resultBytes,
    overflowJson: resultJson,
  };
}

export function buildStorageBackedParentResult(
  input: ParentResultInput,
  resultStorageId: string,
): string {
  const compactFiles = input.exportedFiles.map((file) => ({
    storageId: file.storageId,
    filename: file.filename?.slice(0, 240),
    mimeType: file.mimeType.slice(0, 200),
    sizeBytes: file.sizeBytes,
  }));
  const render = (text: string) => JSON.stringify({
    text,
    resultsSummary: text ? [text] : [],
    importedFiles: [],
    exportedFiles: compactFiles,
    chartsCreated: [],
    warnings: ["Analytics output was compacted; the complete result is available from storage."],
    resultStorageId,
  });
  const fullText = input.text || "Code executed successfully.";
  let low = 0;
  let high = utf8ByteLength(fullText);
  let best = render("");
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = render(truncateUtf8(fullText, middle));
    if (utf8ByteLength(candidate) <= ANALYTICS_PARENT_RESULT_MAX_BYTES) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (utf8ByteLength(best) > ANALYTICS_PARENT_RESULT_MAX_BYTES) {
    best = JSON.stringify({
      text: "Analytics completed. The complete result is available from storage.",
      resultStorageId,
    });
  }
  if (utf8ByteLength(best) > ANALYTICS_PARENT_RESULT_MAX_BYTES) {
    throw new Error("ANALYTICS_PARENT_RESULT_BOUND_UNSATISFIABLE");
  }
  return best;
}
