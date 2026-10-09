import { normalizeGenerationError } from "./generation_error";

export interface GenerationRecovery {
  reason: "insufficient_credits" | "invalid_api_key" | "key_limit" | "request_too_expensive";
  actions: ("openrouter_credits" | "change_model" | "reconnect_openrouter" | "openrouter_keys")[];
}

/** One projection for every client, including failures persisted before this field existed. */
export function generationRecovery(message: {
  role: string; status: string; content: string; terminalErrorCode?: string;
}): GenerationRecovery | undefined {
  if (message.role !== "assistant" || message.status !== "failed" ||
      message.terminalErrorCode?.startsWith("cancelled_")) return undefined;
  const error = normalizeGenerationError(message.content);
  if (error.code === "OPENROUTER_KEY_LIMIT") return { reason: "key_limit", actions: ["openrouter_keys", "change_model"] };
  if (error.code === "OPENROUTER_REQUEST_TOO_EXPENSIVE") return { reason: "request_too_expensive", actions: ["change_model", "openrouter_credits"] };
  if (error.code === "OPENROUTER_SPENDING_RESERVED") return undefined;
  if (error.code === "INSUFFICIENT_CREDITS" ||
      /^(?:Error:\s*)?(?:Your OpenRouter balance is too low|OpenRouter request failed \(HTTP 402\))/i.test(error.message)) {
    return { reason: "insufficient_credits", actions: ["openrouter_credits", "change_model"] };
  }
  if (error.code === "INVALID_API_KEY" || error.code === "MISSING_API_KEY" ||
      /^(?:Error:\s*)?OpenRouter (?:request failed \(HTTP 401\)|could not authenticate)/i.test(error.message)) {
    return { reason: "invalid_api_key", actions: ["reconnect_openrouter"] };
  }
  return undefined;
}
