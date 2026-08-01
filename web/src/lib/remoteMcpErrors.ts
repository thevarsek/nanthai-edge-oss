import type { TFunction } from "i18next";
import { convexErrorData, convexErrorMessage } from "./convexErrors";

const ERROR_KEYS: Record<string, string> = {
  NOT_FOUND: "remote_mcp_error_not_found",
  MCP_INVALID_URL: "remote_mcp_error_invalid_url",
  MCP_UNSAFE_ENDPOINT: "remote_mcp_error_unsafe_endpoint",
  MCP_UNSAFE_HEADER: "remote_mcp_error_unsafe_header",
  MCP_CREDENTIAL_REQUIRED: "remote_mcp_error_credential_required",
  MCP_HEADER_REQUIRED: "remote_mcp_error_header_required",
  MCP_AUTH_REQUIRED: "remote_mcp_error_auth_required",
  MCP_AUTH_UNSUPPORTED: "remote_mcp_error_auth_unsupported",
  MCP_UNSUPPORTED_SERVER: "remote_mcp_unsupported_server",
  MCP_DISABLED: "remote_mcp_error_disabled",
  MCP_ITEM_DISABLED: "remote_mcp_error_item_disabled",
  MCP_URI_REQUIRED: "remote_mcp_error_uri_required",
  MCP_CONTEXT_LIMIT: "remote_mcp_error_context_limit",
  MCP_CONTEXT_UNAVAILABLE: "remote_mcp_error_context_unavailable",
  MCP_CONTEXT_DISABLED: "remote_mcp_error_context_disabled",
  MCP_NOT_READY: "remote_mcp_error_not_ready",
  MCP_ITEM_UNSUPPORTED: "remote_mcp_error_item_unsupported",
  MCP_INPUT_NOT_FOUND: "remote_mcp_error_input_not_found",
  MCP_TASK_NOT_FOUND: "remote_mcp_error_task_not_found",
  MCP_TASK_REPLAY_BLOCKED: "remote_mcp_error_replay_blocked",
  MCP_OAUTH_UNSUPPORTED: "remote_mcp_error_oauth_unsupported",
  MCP_OAUTH_INVALID_CALLBACK: "remote_mcp_error_oauth_callback",
  MCP_OAUTH_STATE_EXPIRED: "remote_mcp_error_oauth_expired",
  MCP_OAUTH_ISSUER_MISMATCH: "remote_mcp_error_oauth_issuer",
  MCP_OAUTH_EXCHANGE_FAILED: "remote_mcp_error_oauth_exchange",
  PRO_REQUIRED: "remote_mcp_error_pro_required",
  ENTITLEMENT_REQUIRED: "remote_mcp_error_pro_required",
};

function structuredCode(error: unknown): string | undefined {
  const data = convexErrorData(error);
  if (typeof data !== "object" || data === null || Array.isArray(data)) return undefined;
  const code = (data as Record<string, unknown>).code;
  return typeof code === "string" ? code : undefined;
}

export function remoteMcpErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  const code = structuredCode(error);
  const key = code ? ERROR_KEYS[code] : undefined;
  if (key) return t(key);
  if (code?.startsWith("MCP_")) return fallback;
  return convexErrorMessage(error, fallback);
}
