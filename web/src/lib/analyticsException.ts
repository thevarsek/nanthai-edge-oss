const SAFE_ERROR_CODES = new Set([
  "ABORT_ERR",
  "CANCELLED",
  "CONFIG_ERROR",
  "CONFLICT",
  "ECONNABORTED",
  "ERR_NETWORK",
  "ETIMEDOUT",
  "EXTERNAL_SERVICE",
  "FORBIDDEN",
  "INTERNAL_ERROR",
  "LOCKED",
  "NETWORK_ERROR",
  "NOT_AUTHORIZED",
  "NOT_FOUND",
  "RATE_LIMITED",
  "SUPERSEDED_VERSION",
  "TIMEOUT",
  "TOO_MANY_REQUESTS",
  "UNAUTHORIZED",
  "VALIDATION",
  "VALIDATION_ERROR",
]);

const STACK_FRAME_PATTERN = /^\s*at\s+/;
const STACK_URL_SUFFIX_PATTERN = /((?:https?:\/\/|webpack:\/\/\/)[^)\s?#]+)[?#][^)\s]*/gi;
const USER_HOME_PATTERN = /\/(Users|home)\/[^/\s)]+/g;
const UUID_ROUTE_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const CONVEX_ID_ROUTE_SEGMENT = /^j[a-z0-9]{20,}$/i;

export type AnalyticsErrorCategory =
  | "authentication"
  | "authorization"
  | "cancelled"
  | "conflict"
  | "http_failure"
  | "network_failure"
  | "not_found"
  | "range_error"
  | "rate_limited"
  | "reference_error"
  | "server_failure"
  | "syntax_error"
  | "timeout"
  | "type_error"
  | "unknown_error"
  | "validation";

export interface AnalyticsExceptionContext {
  boundaryLevel?: string;
  featureArea?: string;
  hasComponentStack?: boolean;
  operation?: string;
  route?: string;
}

export interface AnalyticsExceptionDiagnostic {
  error: Error;
  properties: Record<string, string | number | boolean>;
}

interface ErrorRecord {
  code?: unknown;
  data?: unknown;
  name?: unknown;
  response?: unknown;
  stack?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

function asErrorRecord(value: unknown): ErrorRecord | undefined {
  return typeof value === "object" && value !== null ? value as ErrorRecord : undefined;
}

function safeContextToken(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const token = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_]{0,47}$/.test(token) ? token : fallback;
}

export function safeAnalyticsErrorType(error: unknown): string {
  const candidate = error instanceof Error ? error.name : asErrorRecord(error)?.name;
  if (typeof candidate !== "string") return "UnknownError";
  const trimmed = candidate.trim();
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(trimmed) ? trimmed : "UnknownError";
}

export function analyticsErrorTypeLabel(error: unknown): string {
  return safeAnalyticsErrorType(error)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

function safeErrorCode(error: unknown): string | undefined {
  const record = asErrorRecord(error);
  const data = asErrorRecord(record?.data);
  const candidates = [record?.code, data?.code];
  return candidates.find((candidate): candidate is string => (
    typeof candidate === "string" && SAFE_ERROR_CODES.has(candidate)
  ));
}

function safeHttpStatus(error: unknown): number | undefined {
  const record = asErrorRecord(error);
  const response = asErrorRecord(record?.response);
  const candidates = [record?.status, record?.statusCode, response?.status];
  return candidates.find((candidate): candidate is number => (
    typeof candidate === "number"
      && Number.isInteger(candidate)
      && candidate >= 400
      && candidate <= 599
  ));
}

function categoryForStatus(status: number): AnalyticsErrorCategory {
  if (status === 401) return "authentication";
  if (status === 403) return "authorization";
  if (status === 404) return "not_found";
  if (status === 408 || status === 504) return "timeout";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 400 || status === 422) return "validation";
  if (status >= 500) return "server_failure";
  return "http_failure";
}

function categoryForCode(code: string): AnalyticsErrorCategory | undefined {
  if (["ABORT_ERR", "CANCELLED"].includes(code)) return "cancelled";
  if (["ECONNABORTED", "ETIMEDOUT", "TIMEOUT"].includes(code)) return "timeout";
  if (["ERR_NETWORK", "NETWORK_ERROR"].includes(code)) return "network_failure";
  if (["RATE_LIMITED", "TOO_MANY_REQUESTS"].includes(code)) return "rate_limited";
  if (["UNAUTHORIZED"].includes(code)) return "authentication";
  if (["FORBIDDEN", "NOT_AUTHORIZED"].includes(code)) return "authorization";
  if (code === "NOT_FOUND") return "not_found";
  if (code === "CONFLICT") return "conflict";
  if (["VALIDATION", "VALIDATION_ERROR"].includes(code)) return "validation";
  if (["EXTERNAL_SERVICE", "INTERNAL_ERROR"].includes(code)) return "server_failure";
  return undefined;
}

function categoryForType(errorType: string): AnalyticsErrorCategory {
  if (errorType === "AbortError") return "cancelled";
  if (errorType === "NetworkError") return "network_failure";
  if (errorType === "TimeoutError") return "timeout";
  if (errorType === "RangeError") return "range_error";
  if (errorType === "ReferenceError") return "reference_error";
  if (errorType === "SyntaxError") return "syntax_error";
  if (errorType === "TypeError") return "type_error";
  return "unknown_error";
}

export function analyticsErrorCategory(error: unknown): AnalyticsErrorCategory {
  const status = safeHttpStatus(error);
  if (status !== undefined) return categoryForStatus(status);
  const code = safeErrorCode(error);
  return code ? categoryForCode(code) ?? categoryForType(safeAnalyticsErrorType(error))
    : categoryForType(safeAnalyticsErrorType(error));
}

function sanitizeStack(stack: unknown, heading: string): string | undefined {
  if (typeof stack !== "string") return undefined;
  const frames = stack.split("\n")
    .slice(1)
    .filter((line) => STACK_FRAME_PATTERN.test(line))
    .slice(0, 20)
    .map((line) => line
      .replace(STACK_URL_SUFFIX_PATTERN, "$1")
      .replace(USER_HOME_PATTERN, "/$1/[redacted]"));
  return frames.length > 0 ? [heading, ...frames].join("\n").slice(0, 4_000) : undefined;
}

export function analyticsRouteTemplate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const path = value.split(/[?#]/, 1)[0];
  if (!path) return undefined;
  return path.split("/").map((segment) => (
    UUID_ROUTE_SEGMENT.test(segment) || CONVEX_ID_ROUTE_SEGMENT.test(segment) ? ":id" : segment
  )).join("/");
}

export function buildAnalyticsExceptionDiagnostic(
  error: unknown,
  context: AnalyticsExceptionContext = {},
): AnalyticsExceptionDiagnostic {
  const errorType = safeAnalyticsErrorType(error);
  const errorLabel = analyticsErrorTypeLabel(error);
  const errorCategory = analyticsErrorCategory(error);
  const operation = safeContextToken(context.operation, "unknown_operation");
  const diagnosticError = new Error(`${operation}.${errorCategory}`);
  diagnosticError.name = errorType;
  const originalStack = error instanceof Error ? error.stack : asErrorRecord(error)?.stack;
  diagnosticError.stack = sanitizeStack(
    originalStack,
    `${errorType}: ${operation}.${errorCategory}`,
  ) ?? diagnosticError.stack;

  const code = safeErrorCode(error);
  const status = safeHttpStatus(error);
  const routeTemplate = analyticsRouteTemplate(context.route);
  return {
    error: diagnosticError,
    properties: {
      boundary_level: safeContextToken(context.boundaryLevel, "unknown"),
      error_category: errorCategory,
      error_label: errorLabel,
      error_message_redacted: true,
      error_type: errorType,
      feature_area: safeContextToken(context.featureArea, "error"),
      has_component_stack: context.hasComponentStack === true,
      operation,
      ...(code ? { error_code: code } : {}),
      ...(status !== undefined ? { http_status: status } : {}),
      ...(routeTemplate ? { route_template: routeTemplate } : {}),
    },
  };
}
