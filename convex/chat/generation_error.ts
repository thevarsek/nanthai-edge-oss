import { ConvexError } from "convex/values";

export interface NormalizedGenerationError {
  code: string;
  message: string;
}

const DEFAULT_ERROR: NormalizedGenerationError = {
  code: "UNKNOWN_ERROR",
  message: "Unknown generation error",
};

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withoutPrefix = trimmed.startsWith("Error:")
    ? trimmed.slice("Error:".length).trim()
    : trimmed;
  try {
    return JSON.parse(withoutPrefix);
  } catch {
    return undefined;
  }
}

function fromPayload(
  value: unknown,
  fallbackCode: string,
  depth = 0,
): NormalizedGenerationError | undefined {
  if (value == null || depth > 6) return undefined;

  if (typeof value === "string") {
    const parsed = parseJsonString(value);
    if (parsed !== undefined) {
      return fromPayload(parsed, fallbackCode, depth + 1);
    }
    const message = value.trim();
    return message ? { code: fallbackCode, message } : undefined;
  }

  if (typeof value !== "object") {
    return { code: fallbackCode, message: String(value) };
  }

  const record = value as Record<string, unknown>;
  const code = [record.code, record.error_type, record.type]
    .find((candidate) =>
      typeof candidate === "string" && candidate.trim().length > 0
    );
  if (typeof record.message === "string" && record.message.trim()) {
    return {
      code: typeof code === "string" ? code : fallbackCode,
      message: record.message.trim(),
    };
  }

  for (const key of ["error", "data", "cause", "details", "response"]) {
    if (!(key in record)) continue;
    const nested = fromPayload(record[key], fallbackCode, depth + 1);
    if (nested) {
      return {
        code: typeof code === "string" ? code : nested.code,
        message: nested.message,
      };
    }
  }

  try {
    return { code: fallbackCode, message: JSON.stringify(record) };
  } catch {
    return undefined;
  }
}

export function normalizeGenerationError(
  error: unknown,
): NormalizedGenerationError {
  if (error instanceof ConvexError) {
    return fromPayload(error.data, "CONVEX_ERROR") ?? DEFAULT_ERROR;
  }
  if (error instanceof Error) {
    return fromPayload(error.message, error.name || "ERROR") ?? DEFAULT_ERROR;
  }
  return fromPayload(error, "UNKNOWN_ERROR") ?? DEFAULT_ERROR;
}
