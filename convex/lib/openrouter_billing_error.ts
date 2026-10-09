/** Closed-vocabulary billing metadata; never copy provider free text into diagnostics. */
export function openRouterBillingError(payload: unknown): { code: string; message: string } | undefined {
  let value = payload;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  if (!value || typeof value !== "object") return undefined;
  const root = value as Record<string, unknown>;
  const error = root.error && typeof root.error === "object" ? root.error as Record<string, unknown> : root;
  const metadata = error.metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const { limit_source: source, reason } = metadata as Record<string, unknown>;
  if (source === "openrouter_in_flight_budget") return {
    code: "OPENROUTER_SPENDING_RESERVED",
    message: "OpenRouter has temporarily reserved spending capacity for running or recently completed requests. Wait for them to settle, then try again. Your account may still have credits.",
  };
  if (source === "openrouter_key_limit") return {
    code: "OPENROUTER_KEY_LIMIT",
    message: "This OpenRouter connection has reached its spending limit. Review the key limit in OpenRouter, or wait for its configured reset. Your account may still have credits.",
  };
  if (source === "openrouter_credits" && reason === "weight_exceeds_budget") return {
    code: "OPENROUTER_REQUEST_TOO_EXPENSIVE",
    message: "This request is larger than OpenRouter's available spending budget. Try a cheaper model, reduce the prompt or response length, or add credits.",
  };
  return undefined;
}
