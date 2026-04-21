// convex/tools/slack/mcp_probe.ts
// =============================================================================
// Shared helper: perform the 3-step MCP handshake against
// https://mcp.slack.com/mcp and return tools/list.
//
// Used by:
//   - diagnose.ts (manual probe)
//   - drift_check.ts (weekly cron)
// =============================================================================

const SLACK_MCP_ENDPOINT = "https://mcp.slack.com/mcp";
const PROTOCOL_VERSION = "2025-03-26"; // Slack negotiates up to 2025-06-18.

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

function parseSSE(text: string): JsonRpcResponse | null {
  let last = "";
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) last = line.slice(6).trim();
  }
  if (!last) return null;
  try {
    return JSON.parse(last) as JsonRpcResponse;
  } catch {
    return null;
  }
}

async function rpc(
  accessToken: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ response: Response; parsed: JsonRpcResponse | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const response = await fetch(SLACK_MCP_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  let parsed: JsonRpcResponse | null = null;
  if (contentType.includes("text/event-stream")) {
    parsed = parseSSE(await response.text());
  } else if (contentType.includes("application/json")) {
    try {
      parsed = (await response.json()) as JsonRpcResponse;
    } catch {
      parsed = null;
    }
  }
  return { response, parsed };
}

/**
 * Perform the full MCP handshake (initialize → notifications/initialized → tools/list)
 * and return the parsed tools array. Throws on any step failure.
 */
export async function fetchLiveMcpTools(accessToken: string): Promise<McpTool[]> {
  // 1. initialize
  const init = await rpc(accessToken, {
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "NanthAI-DriftCheck", version: "1.0.0" },
    },
  });
  if (!init.response.ok) {
    throw new Error(
      `MCP initialize failed: HTTP ${init.response.status} ${JSON.stringify(init.parsed)}`,
    );
  }
  const sessionId = init.response.headers.get("mcp-session-id") ?? undefined;

  // 2. notifications/initialized
  const notifyHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) notifyHeaders["Mcp-Session-Id"] = sessionId;
  await fetch(SLACK_MCP_ENDPOINT, {
    method: "POST",
    headers: notifyHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });

  // 3. tools/list
  const list = await rpc(
    accessToken,
    { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    sessionId,
  );
  if (!list.response.ok) {
    throw new Error(
      `MCP tools/list failed: HTTP ${list.response.status} ${JSON.stringify(list.parsed)}`,
    );
  }

  const result = list.parsed?.result as { tools?: McpTool[] } | undefined;
  return result?.tools ?? [];
}
