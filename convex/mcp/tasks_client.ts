"use node";

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/client";
import { randomUUID } from "node:crypto";
import { createDefaultMcpGatewayFetch } from "./gateway_fetch";
import { MCP_PROTOCOL_VERSION, serializeBoundedMcpResult } from "./policy";
import type { McpConnectionCredential } from "./sdk_client";

function taskHeaders(
  method: string,
  taskId: string,
  credential?: McpConnectionCredential,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    "Mcp-Method": method,
    "Mcp-Name": taskId,
  };
  if (credential?.bearerToken) headers.Authorization = `Bearer ${credential.bearerToken}`;
  if (credential?.apiKeyHeader && credential.apiKeyValue) {
    headers[credential.apiKeyHeader] = credential.apiKeyValue;
  }
  return headers;
}

function parseSse(text: string, requestId: string): unknown {
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) continue;
    const message = JSON.parse(data) as Record<string, unknown>;
    if (message.id === requestId) return message;
  }
  throw new Error("MCP task response was incomplete.");
}

export async function sendTaskRequest(args: {
  endpoint: string;
  method: "tasks/get" | "tasks/update" | "tasks/cancel";
  taskId: string;
  inputResponses?: unknown;
  credential?: McpConnectionCredential;
}): Promise<Record<string, unknown>> {
  if (!/^[\x21-\x7e]{1,512}$/.test(args.taskId)) throw new Error("Invalid MCP task ID.");
  const id = randomUUID();
  const params: Record<string, unknown> = {
    taskId: args.taskId,
    _meta: {
      [PROTOCOL_VERSION_META_KEY]: MCP_PROTOCOL_VERSION,
      [CLIENT_INFO_META_KEY]: { name: "NanthAI", version: "1.0.0" },
      [CLIENT_CAPABILITIES_META_KEY]: {
        elicitation: { form: {}, url: {} },
        extensions: { "io.modelcontextprotocol/tasks": {} },
      },
    },
  };
  if (args.method === "tasks/update") params.inputResponses = args.inputResponses ?? {};
  const response = await createDefaultMcpGatewayFetch(args.credential?.apiKeyHeader)(args.endpoint, {
    method: "POST",
    redirect: "manual",
    headers: taskHeaders(args.method, args.taskId, args.credential),
    body: JSON.stringify({ jsonrpc: "2.0", id, method: args.method, params }),
  });
  if (!response.ok) throw new Error("MCP task transport failed.");
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  const message = contentType.includes("text/event-stream")
    ? parseSse(text, id)
    : JSON.parse(text) as Record<string, unknown>;
  if (typeof message !== "object" || message === null) {
    throw new Error("MCP task protocol response was invalid.");
  }
  const record = message as Record<string, unknown>;
  if (record.id !== id || "error" in record) throw new Error("MCP task protocol response was invalid.");
  const result = record.result;
  if (typeof result !== "object" || result === null || (result as Record<string, unknown>).resultType !== "complete") {
    throw new Error("MCP task result was invalid.");
  }
  serializeBoundedMcpResult(result);
  return result as Record<string, unknown>;
}
