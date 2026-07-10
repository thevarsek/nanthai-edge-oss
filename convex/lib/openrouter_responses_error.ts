export const GENERIC_ADVISOR_FAILURE = "Advisor consultation failed.";

const MAX_ADVISOR_FAILURE_CHARS = 300;
const MAX_DIAGNOSTIC_DEPTH = 8;
const SENSITIVE_TEXT_PATTERN = new RegExp([
  "SDKValidationError",
  "ZodError",
  "rawValue",
  "chatRequest",
  "toolCallId",
  "<persona_instructions>",
  "Private Advisor brief",
  String.raw`\\?[\"']messages\\?[\"']\s*:`,
  String.raw`\\?[\"']instructions\\?[\"']\s*:`,
].join("|"), "i");

/**
 * Preserve a useful provider message while dropping any request, transcript,
 * Persona, or SDK-validation dump that must never enter the product contract.
 */
export function conciseAdvisorFailure(value: unknown): string {
  const canonical = canonicalAdvisorMessage(value);
  return canonical.message === undefined
    ? GENERIC_ADVISOR_FAILURE
    : safeAdvisorFailureText(canonical.message);
}

/** Hide backend-generic messages so clients use their localized status copy. */
export function projectedAdvisorFailure(
  value: unknown,
  errorCode?: string,
): string | undefined {
  if (errorCode === "ADVISOR_TIMEOUT" || errorCode === "ADVISOR_CANCELLED") {
    return undefined;
  }
  const message = conciseAdvisorFailure(value);
  return message === GENERIC_ADVISOR_FAILURE ? undefined : message;
}

function canonicalAdvisorMessage(
  value: unknown,
  depth = 0,
): { message?: string; structured: boolean } {
  if (depth > MAX_DIAGNOSTIC_DEPTH || value == null) {
    return { structured: value != null && typeof value === "object" };
  }
  if (value instanceof Error) {
    return canonicalAdvisorMessage(value.message, depth + 1);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { structured: false };
    const parsed = parseStructuredText(trimmed);
    if (parsed.value !== undefined) {
      const nested = canonicalAdvisorMessage(parsed.value, depth + 1);
      return { message: nested.message, structured: true };
    }
    if (parsed.looksStructured) return { structured: true };
    return { message: trimmed, structured: false };
  }
  if (typeof value !== "object") return { structured: false };
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = canonicalAdvisorMessage(item, depth + 1);
      if (nested.message !== undefined) {
        return { message: nested.message, structured: true };
      }
    }
    return { structured: true };
  }

  const record = value as Record<string, unknown>;
  for (const key of ["message", "rawMessage"] as const) {
    if (!(key in record)) continue;
    const nested = canonicalAdvisorMessage(record[key], depth + 1);
    if (nested.message !== undefined) {
      return { message: nested.message, structured: true };
    }
  }
  for (const key of ["error", "data", "response"] as const) {
    if (!(key in record)) continue;
    const nested = canonicalAdvisorMessage(record[key], depth + 1);
    if (nested.message !== undefined) {
      return { message: nested.message, structured: true };
    }
  }
  return { structured: true };
}

function parseStructuredText(
  value: string,
): { value?: unknown; looksStructured: boolean } {
  try {
    return { value: JSON.parse(value) as unknown, looksStructured: true };
  } catch {
    // Provider and SDK errors commonly prefix a serialized payload with a
    // short label. Try each possible object/array suffix before failing closed.
  }

  const starts: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "{" || value[index] === "[") starts.push(index);
  }
  let looksStructured = false;
  for (const start of starts) {
    const suffix = value.slice(start).trim();
    looksStructured ||= looksLikeStructuredDiagnostic(suffix);
    try {
      return { value: JSON.parse(suffix) as unknown, looksStructured: true };
    } catch {
      // A later delimiter may begin the actual serialized envelope.
    }
  }
  return { looksStructured };
}

function looksLikeStructuredDiagnostic(value: string): boolean {
  if (value === "{}" || value === "[]") return true;
  return /^(?:\{\s*(?:\\?["'][^"']+\\?["']|[A-Za-z_$][\w$-]*)\s*:|\[\s*(?:\{|\\?["']))/.test(value);
}

function safeAdvisorFailureText(value: string): string {
  if (SENSITIVE_TEXT_PATTERN.test(value)) {
    return GENERIC_ADVISOR_FAILURE;
  }
  const message = value.replace(/\s+/g, " ").trim();
  if (!message) return GENERIC_ADVISOR_FAILURE;
  if (message.length <= MAX_ADVISOR_FAILURE_CHARS) return message;
  return `${message.slice(0, MAX_ADVISOR_FAILURE_CHARS - 1).trimEnd()}…`;
}
