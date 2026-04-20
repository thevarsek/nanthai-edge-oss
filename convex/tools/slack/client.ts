// convex/tools/slack/client.ts
// =============================================================================
// Slack MCP client — JSON-RPC 2.0 over Streamable HTTP.
//
// Each tool invocation does:
//   1. POST initialize → get Mcp-Session-Id
//   2. POST notifications/initialized (no response expected)
//   3. POST tools/call with the actual tool name + arguments
//
// All 3 requests go to https://mcp.slack.com/mcp with the user token as
// Bearer auth. The session ID is ephemeral (not persisted across actions).
//
// Uses request_gates coordination (same pattern as Notion/Cloze) so
// concurrent chats/jobs for the same user share a bounded request cadence.
// =============================================================================

import { internal } from "../../_generated/api";
import { ToolExecutionContext } from "../registry";

// https://docs.slack.dev/ai/slack-mcp-server#transport-protocol-and-endpoint
const SLACK_MCP_ENDPOINT = "https://mcp.slack.com/mcp";
const MAX_RETRIES = 3;
const SLACK_PROVIDER = "slack";
const REQUEST_LEASE_MS = 25_000;
const MIN_REQUEST_GAP_MS = 300;

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(retryAfter: string | null): number | null {
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.ceil(seconds * 1000);
}

function backoffMs(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** attempt);
}

function applyMinimumGap(delayMs: number): number {
  return Math.max(MIN_REQUEST_GAP_MS, Math.ceil(delayMs));
}

async function acquireRequestSlot(
  toolCtx: ToolExecutionContext,
  requestId: string,
): Promise<void> {
  while (true) {
    const now = Date.now();
    const result: { granted: boolean; waitMs: number } =
      await toolCtx.ctx.runMutation(
        internal.integrations.request_gates.claimRequestSlot,
        {
          userId: toolCtx.userId,
          provider: SLACK_PROVIDER,
          requestId,
          now,
          leaseMs: REQUEST_LEASE_MS,
        },
      );

    if (result.granted) {
      return;
    }

    await sleep(Math.max(25, Math.min(result.waitMs, 5_000)));
  }
}

async function releaseRequestSlot(
  toolCtx: ToolExecutionContext,
  requestId: string,
  nextAllowedAt: number,
  lastResponseStatus?: number,
): Promise<void> {
  await toolCtx.ctx.runMutation(
    internal.integrations.request_gates.releaseRequestSlot,
    {
      userId: toolCtx.userId,
      provider: SLACK_PROVIDER,
      requestId,
      now: Date.now(),
      nextAllowedAt,
      lastResponseStatus,
    },
  );
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 helpers
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

let nextRpcId = 0;

/**
 * Reset the RPC ID counter. Called at the start of each callSlackMcpTool
 * invocation so IDs are scoped per-call rather than leaking across isolate
 * reuses.
 */
function resetRpcId(): void {
  nextRpcId = 0;
}

function makeRpcRequest(
  method: string,
  params?: Record<string, unknown>,
  isNotification = false,
): JsonRpcRequest {
  const req: JsonRpcRequest = { jsonrpc: "2.0", method };
  if (!isNotification) {
    req.id = nextRpcId++;
  }
  if (params) {
    req.params = params;
  }
  return req;
}

// ---------------------------------------------------------------------------
// Raw gated fetch to the MCP endpoint
// ---------------------------------------------------------------------------

async function mcpFetch(
  toolCtx: ToolExecutionContext,
  accessToken: string,
  body: JsonRpcRequest,
  sessionId?: string,
): Promise<{ response: Response; parsed: JsonRpcResponse | null }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const requestId = crypto.randomUUID();
    await acquireRequestSlot(toolCtx, requestId);

    let response: Response | null = null;
    let delayMs = MIN_REQUEST_GAP_MS;

    try {
      response = await fetch(SLACK_MCP_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (
        !RETRYABLE_STATUS_CODES.has(response.status) ||
        attempt === MAX_RETRIES
      ) {
        // Parse the response body
        const contentType = response.headers.get("content-type") ?? "";
        let parsed: JsonRpcResponse | null = null;

        if (contentType.includes("text/event-stream")) {
          // SSE — extract the JSON-RPC response from the data events
          const text = await response.text();
          parsed = parseSSEResponse(text);
        } else if (contentType.includes("application/json")) {
          try {
            parsed = (await response.json()) as JsonRpcResponse;
          } catch {
            // Malformed or empty JSON body — treat as unparseable
            parsed = null;
          }
        }

        return { response, parsed };
      }

      delayMs =
        response.status === 429
          ? applyMinimumGap(
              parseRetryAfterMs(response.headers.get("retry-after")) ??
                backoffMs(attempt),
            )
          : applyMinimumGap(backoffMs(attempt));
    } catch (error) {
      if (attempt === MAX_RETRIES) {
        throw error;
      }
      delayMs = applyMinimumGap(backoffMs(attempt));
    } finally {
      await releaseRequestSlot(
        toolCtx,
        requestId,
        Date.now() + delayMs,
        response?.status,
      );
    }

    await sleep(delayMs);
  }

  throw new Error("Unreachable");
}

/**
 * Parse a Server-Sent Events response to extract the JSON-RPC message.
 * Slack MCP may return SSE for streaming; we collect all `data:` lines
 * and parse the last complete JSON-RPC message.
 */
function parseSSEResponse(text: string): JsonRpcResponse | null {
  const lines = text.split("\n");
  let lastData = "";
  for (const line of lines) {
    if (line.startsWith("data: ")) {
      lastData = line.slice(6).trim();
    }
  }
  if (!lastData) return null;
  try {
    return JSON.parse(lastData) as JsonRpcResponse;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API: callSlackMcpTool
// ---------------------------------------------------------------------------

export interface SlackMcpToolResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

/**
 * Call a Slack MCP tool using the 3-step handshake:
 *   1. initialize
 *   2. notifications/initialized
 *   3. tools/call
 *
 * Returns the tool result or throws on error.
 */
export async function callSlackMcpTool(
  toolCtx: ToolExecutionContext,
  accessToken: string,
  toolName: string,
  toolArgs: Record<string, unknown>,
): Promise<SlackMcpToolResult> {
  resetRpcId();

  // Step 1: Initialize
  const initReq = makeRpcRequest("initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "NanthAI", version: "1.0.0" },
  });

  const { response: initResponse, parsed: initParsed } = await mcpFetch(
    toolCtx,
    accessToken,
    initReq,
  );

  if (!initResponse.ok) {
    const errorText = initParsed?.error?.message ?? `HTTP ${initResponse.status}`;
    if (initResponse.status === 401 || initResponse.status === 403) {
      throw new Error(
        `Slack authentication failed. The user may need to reconnect Slack. (${errorText})`,
      );
    }
    throw new Error(`Slack MCP initialize failed: ${errorText}`);
  }

  // Extract session ID for subsequent requests
  const sessionId =
    initResponse.headers.get("mcp-session-id") ?? undefined;

  // Step 2: notifications/initialized — a JSON-RPC notification (no response
  // expected). We send it without going through the request gate since it
  // doesn't consume a meaningful rate-limit slot.
  const notifyReq = makeRpcRequest(
    "notifications/initialized",
    undefined,
    true,
  );
  const notifyHeaders: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    notifyHeaders["Mcp-Session-Id"] = sessionId;
  }
  await fetch(SLACK_MCP_ENDPOINT, {
    method: "POST",
    headers: notifyHeaders,
    body: JSON.stringify(notifyReq),
  });

  // Step 3: tools/call
  const callReq = makeRpcRequest("tools/call", {
    name: toolName,
    arguments: toolArgs,
  });

  const { response: callResponse, parsed: callParsed } = await mcpFetch(
    toolCtx,
    accessToken,
    callReq,
    sessionId,
  );

  if (!callResponse.ok) {
    const errorText = callParsed?.error?.message ?? `HTTP ${callResponse.status}`;
    if (callResponse.status === 401 || callResponse.status === 403) {
      throw new Error(
        `Slack authentication failed during tool call. The user may need to reconnect Slack. (${errorText})`,
      );
    }
    throw new Error(`Slack MCP tools/call failed: ${errorText}`);
  }

  if (callParsed?.error) {
    const errMsg = callParsed.error.message;
    // Handle missing_scope errors gracefully
    if (
      typeof callParsed.error.data === "string" &&
      callParsed.error.data.includes("missing_scope")
    ) {
      return {
        content: [
          {
            type: "text",
            text: `This action requires a Slack scope the user didn't grant. Ask them to reconnect Slack with additional permissions. Error: ${errMsg}`,
          },
        ],
        isError: true,
      };
    }
    throw new Error(`Slack MCP tool error: ${errMsg}`);
  }

  const result = callParsed?.result as SlackMcpToolResult | undefined;
  if (!result || !Array.isArray(result.content)) {
    // Fallback: wrap raw result
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(callParsed?.result ?? "No result returned"),
        },
      ],
    };
  }

  return result;
}
