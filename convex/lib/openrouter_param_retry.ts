import { ChatRequestParameters } from "./openrouter_types";

const UNSUPPORTED_PARAM_PATTERNS: RegExp[] = [
  /unsupported(?:\s+request)?\s+(?:parameter|setting)s?:?\s*["'`]?([a-zA-Z0-9_.-]+)["'`]?/i,
  /unknown name\s*["'`]?([a-zA-Z0-9_.-]+)["'`]?/i,
  /cannot find field\s*["'`]?([a-zA-Z0-9_.-]+)["'`]?/i,
  /unrecognized (?:field|parameter)\s*["'`]?([a-zA-Z0-9_.-]+)["'`]?/i,
  /does not support(?:\s+the)?\s+(?:parameter|setting)?\s*["'`]?([a-zA-Z0-9_.-]+)["'`]?/i,
];

export function normalizeUnsupportedParameterName(rawName: string): string {
  const normalized = rawName.trim().toLowerCase();
  const terminal = normalized.split(".").pop() ?? normalized;

  switch (terminal) {
    case "max_output_tokens":
    case "max_completion_tokens":
      return "max_tokens";
    case "reasoning_effort":
    case "reasoning.effort":
      return "reasoning";
    case "imageconfig":
      return "image_config";
    default:
      return terminal;
  }
}

function parseUnsupportedParameterFromText(errorMessage: string): string | null {
  for (const pattern of UNSUPPORTED_PARAM_PATTERNS) {
    const match = errorMessage.match(pattern);
    const value = match?.[1];
    if (!value) continue;
    return normalizeUnsupportedParameterName(value);
  }

  const normalizedMessage = errorMessage.toLowerCase();
  const knownParameters = [
    "temperature",
    "max_tokens",
    "include_reasoning",
    "reasoning",
    "modalities",
    "image_config",
    "plugins",
    "transforms",
    "web_search",
  ];

  if (
    normalizedMessage.includes("unsupported") ||
    normalizedMessage.includes("unknown") ||
    normalizedMessage.includes("does not support")
  ) {
    for (const parameter of knownParameters) {
      if (normalizedMessage.includes(parameter)) {
        return parameter;
      }
    }
  }

  return null;
}

export function parseUnsupportedParameter(
  payload: unknown,
  depth = 0,
): string | null {
  if (payload == null || depth > 6) return null;

  if (typeof payload === "string") {
    const fromText = parseUnsupportedParameterFromText(payload);
    if (fromText) return fromText;

    try {
      const parsed = JSON.parse(payload);
      return parseUnsupportedParameter(parsed, depth + 1);
    } catch {
      return null;
    }
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const fromItem = parseUnsupportedParameter(item, depth + 1);
      if (fromItem) return fromItem;
    }
    return null;
  }

  if (typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const directCandidates = [
    record.param,
    record.parameter,
    record.unsupported_parameter,
    record.unsupportedParam,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return normalizeUnsupportedParameterName(candidate);
    }
  }

  const nestedKeys = [
    "error",
    "metadata",
    "raw",
    "message",
    "details",
    "detail",
    "cause",
    "response",
  ];

  for (const key of nestedKeys) {
    if (!(key in record)) continue;
    const fromNested = parseUnsupportedParameter(record[key], depth + 1);
    if (fromNested) return fromNested;
  }

  return null;
}

export function stripParameter(
  paramName: string,
  params: ChatRequestParameters,
): ChatRequestParameters | null {
  const normalizedName = normalizeUnsupportedParameterName(paramName);
  const stripped = { ...params };
  switch (normalizedName) {
    case "temperature":
      if (stripped.temperature == null) return null;
      stripped.temperature = null;
      return stripped;
    case "max_tokens":
      if (stripped.maxTokens == null) return null;
      stripped.maxTokens = null;
      return stripped;
    case "include_reasoning":
      if (stripped.includeReasoning == null) return null;
      stripped.includeReasoning = null;
      return stripped;
    case "reasoning":
      if (stripped.reasoningEffort == null) return null;
      stripped.reasoningEffort = null;
      return stripped;
    case "modalities":
      if (stripped.modalities == null) return null;
      stripped.modalities = null;
      return stripped;
    case "image_config":
      if (stripped.imageConfig == null) return null;
      stripped.imageConfig = null;
      return stripped;
    case "plugins":
      if (stripped.plugins == null) return null;
      stripped.plugins = null;
      return stripped;
    case "transforms":
      if (stripped.transforms === null) return null;
      stripped.transforms = null;
      return stripped;
    case "web_search":
      if (!stripped.webSearchEnabled) return null;
      stripped.webSearchEnabled = false;
      return stripped;
    default:
      return null; // Unknown parameter, can't strip
  }
}
