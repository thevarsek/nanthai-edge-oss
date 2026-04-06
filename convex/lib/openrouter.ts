// convex/lib/openrouter.ts
// =============================================================================
// Public OpenRouter API surface for Convex chat/autonomous modules.
//
// Keep exports stable from this module path. Internals are split across
// focused helper modules to reduce risk and improve testability.
// =============================================================================

export {
  retryAfterToMs,
  rateLimitDelayMs,
} from "./openrouter_constants";
export { gateParameters } from "./openrouter_gate";
export { callOpenRouterStreaming } from "./openrouter_stream";
export { callOpenRouterNonStreaming } from "./openrouter_nonstream";
export { resolvePerplexityCitations } from "./openrouter_types";

export type {
  ChatRequestParameters,
  ContentPart,
  NonStreamResult,
  OnDelta,
  OnReasoningDelta,
  OpenRouterMessage,
  OpenRouterUsage,
  PerplexityAnnotation,
  RetryConfig,
  StreamResult,
  ToolCall,
  ToolCallDelta,
  ToolChoice,
  ToolDefinition,
} from "./openrouter_types";
