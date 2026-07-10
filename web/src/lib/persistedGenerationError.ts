const MAX_NESTING_DEPTH = 8;
const LEADING_ERROR_PREFIX = /^\s*Error:\s*/;

export interface MessageDisplaySource {
  role: string;
  status: string;
  content: string;
}

/** Recursively unwrap a structured error value into its user-facing message. */
export function structuredErrorMessage(value: unknown, depth = 0): string | null {
  if (depth > MAX_NESTING_DEPTH || value == null) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      return structuredErrorMessage(JSON.parse(trimmed), depth + 1);
    } catch {
      return trimmed;
    }
  }

  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "data"] as const) {
    if (!(key in record)) continue;
    const message = structuredErrorMessage(record[key], depth + 1);
    if (message) return message;
  }
  return null;
}

/**
 * Parse an error serialized into persisted assistant content. Parsing is
 * deliberately strict so ordinary assistant prose is never rewritten.
 */
export function persistedGenerationErrorMessage(rawContent: string): string | null {
  const candidate = rawContent.replace(LEADING_ERROR_PREFIX, "").trim();
  if (!candidate) return null;
  try {
    return structuredErrorMessage(JSON.parse(candidate));
  } catch {
    return null;
  }
}

/** Project the display/search/copy text for one message without mutating it. */
export function displayMessageContent(message: MessageDisplaySource): string {
  if (message.role !== "assistant" || message.status !== "failed") {
    return message.content;
  }
  return persistedGenerationErrorMessage(message.content) ?? message.content;
}
