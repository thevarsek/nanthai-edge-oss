import { ConvexError } from "convex/values";
import type { OpenRouterImageRequest } from "./openrouter_image";

const CODES = new Set([
  "invalid_request", "invalid_request_error", "invalid_parameter", "unsupported_parameter",
  "validation_error", "content_policy_violation", "content_filter", "safety_violation",
  "insufficient_credits", "rate_limit_exceeded", "rate_limit_error", "authentication_error",
  "invalid_api_key", "provider_error", "internal_error", "model_not_found",
]);
const PARAMETERS = new Set([
  "model", "prompt", "input_references", "n", "aspect_ratio", "resolution", "size",
  "quality", "background", "output_format", "output_compression",
]);
type Diagnostics = Record<string, string | number>;

/** Closed vocabulary only: provider messages/raw bodies can contain prompts and credentials. */
export function imageFailureDiagnostics(status: number, payload: unknown, request: OpenRouterImageRequest): Diagnostics {
  const diagnostics: Diagnostics = { provider_http_status: status };
  const visit = (value: unknown, depth = 0): void => {
    if (depth > 5) return;
    if (typeof value === "string") {
      if (value.length > 64_000) return;
      try { visit(JSON.parse(value), depth + 1); } catch { /* Never retain free text. */ }
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const key of ["code", "type"]) {
      const code = typeof record[key] === "string" ? record[key].toLowerCase() : "";
      if (CODES.has(code)) diagnostics.provider_error_code = code;
    }
    const parameter = record.param ?? record.parameter;
    if (typeof parameter === "string" && PARAMETERS.has(parameter)) diagnostics.provider_error_parameter = parameter;
    for (const key of ["error", "metadata", "raw"]) visit(record[key], depth + 1);
  };
  visit(payload);
  diagnostics.provider_error_code ??= "unclassified";
  diagnostics.image_request_reference_count = request.inputReferences?.length ?? 0;
  const fields: [string, unknown, RegExp][] = [
    ["aspect_ratio", request.aspectRatio, /^(?:auto|[1-9][0-9]?:[1-9][0-9]?)$/],
    ["resolution", request.resolution, /^(?:512|768|1K|1\.5K|2K|4K|8K|auto)$/],
    ["size", request.resolution ? undefined : request.size, /^(?:auto|[0-9]{2,5}x[0-9]{2,5})$/],
    ["quality", request.quality, /^(?:auto|low|medium|high|standard|hd)$/],
    ["background", request.background, /^(?:auto|transparent|opaque)$/],
    ["output_format", request.outputFormat, /^(?:png|jpeg|jpg|webp|svg)$/],
  ];
  for (const [key, value, pattern] of fields) {
    if (value !== undefined) diagnostics[`image_request_${key}`] = typeof value === "string" && pattern.test(value) ? value : "unrecognized";
  }
  if (request.n !== undefined && Number.isFinite(request.n)) diagnostics.image_request_count = request.n;
  if (request.outputCompression !== undefined && Number.isFinite(request.outputCompression)) diagnostics.image_request_output_compression = request.outputCompression;
  return diagnostics;
}

/** Revalidate even our own error envelope before sending analytics. */
export function imageFailureAnalytics(error: unknown): Diagnostics {
  if (!(error instanceof ConvexError) || !error.data || typeof error.data !== "object") return {};
  const raw = (error.data as Record<string, unknown>).diagnostics;
  if (!raw || typeof raw !== "object") return {};
  const d = raw as Record<string, unknown>;
  const result: Diagnostics = {};
  if (typeof d.provider_http_status === "number" && Number.isInteger(d.provider_http_status) && d.provider_http_status >= 100 && d.provider_http_status <= 599) result.provider_http_status = d.provider_http_status;
  if (typeof d.provider_error_code === "string" && (CODES.has(d.provider_error_code) || d.provider_error_code === "unclassified")) result.provider_error_code = d.provider_error_code;
  if (typeof d.provider_error_parameter === "string" && PARAMETERS.has(d.provider_error_parameter)) result.provider_error_parameter = d.provider_error_parameter;
  return result;
}
