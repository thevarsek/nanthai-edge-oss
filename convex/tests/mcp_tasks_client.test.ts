import assert from "node:assert/strict";
import test from "node:test";
import { sendTaskRequest } from "../mcp/tasks_client";

test("Tasks adapter emits pinned extension metadata and task routing headers", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.MCP_EGRESS_URL;
  const previousSecret = process.env.MCP_EGRESS_SHARED_SECRET;
  let gatewayBody: Record<string, unknown> | undefined;
  process.env.MCP_EGRESS_URL = "https://egress.invalid/mcp";
  process.env.MCP_EGRESS_SHARED_SECRET = "test-shared-secret";
  globalThis.fetch = async (_input, init) => {
    gatewayBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const request = JSON.parse(String(gatewayBody.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { resultType: "complete", taskId: "task-1", status: "working" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const result = await sendTaskRequest({
      endpoint: "https://mcp.example.com/mcp",
      method: "tasks/update",
      taskId: "task-1",
      inputResponses: { answer: { action: "accept", content: { value: 2 } } },
      credential: { bearerToken: "private-token" },
    });
    assert.equal(result.status, "working");
    assert.equal(gatewayBody?.url, "https://mcp.example.com/mcp");
    const headers = gatewayBody?.headers as Record<string, string>;
    assert.equal(headers["Mcp-Method"] ?? headers["mcp-method"], "tasks/update");
    assert.equal(headers["Mcp-Name"] ?? headers["mcp-name"], "task-1");
    const request = JSON.parse(String(gatewayBody?.body)) as {
      params: { inputResponses: unknown; _meta: Record<string, unknown> };
    };
    assert.deepEqual(request.params.inputResponses, {
      answer: { action: "accept", content: { value: 2 } },
    });
    assert.match(JSON.stringify(request.params._meta), /2026-07-28/);
    assert.match(JSON.stringify(request.params._meta), /io\.modelcontextprotocol\/tasks/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.MCP_EGRESS_URL;
    else process.env.MCP_EGRESS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.MCP_EGRESS_SHARED_SECRET;
    else process.env.MCP_EGRESS_SHARED_SECRET = previousSecret;
  }
});

test("Tasks adapter rejects results above the MCP persistence limit", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.MCP_EGRESS_URL;
  const previousSecret = process.env.MCP_EGRESS_SHARED_SECRET;
  process.env.MCP_EGRESS_URL = "https://egress.invalid/mcp";
  process.env.MCP_EGRESS_SHARED_SECRET = "test-shared-secret";
  globalThis.fetch = async (_input, init) => {
    const gatewayBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const request = JSON.parse(String(gatewayBody.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      id: request.id,
      result: { resultType: "complete", status: "completed", text: "😀".repeat(70_000) },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    await assert.rejects(() => sendTaskRequest({
      endpoint: "https://mcp.example.com/mcp",
      method: "tasks/get",
      taskId: "task-1",
    }), /MCP_RESULT_TOO_LARGE/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.MCP_EGRESS_URL;
    else process.env.MCP_EGRESS_URL = previousUrl;
    if (previousSecret === undefined) delete process.env.MCP_EGRESS_SHARED_SECRET;
    else process.env.MCP_EGRESS_SHARED_SECRET = previousSecret;
  }
});
