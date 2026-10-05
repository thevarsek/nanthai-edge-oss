import assert from "node:assert/strict";
import test from "node:test";

import {
  mapNativeInputResponse,
  normalizeNativeRequest,
} from "../src/codex_request_mapping.ts";
import { AdapterEventSchema, type AdapterEvent } from "../src/protocol.ts";

const base = {
  protocolVersion: "nanthai.runtime.v1",
  eventId: "event-1",
  sequence: 1,
  occurredAt: 1,
  runId: "run-1",
  attemptId: "attempt-1",
  fence: 1,
  sessionId: "session-1",
};
const create = (fields: Record<string, unknown>): AdapterEvent =>
  AdapterEventSchema.parse({ ...base, ...fields });

test("preserves MCP form message, schema, metadata, and exact accept response", () => {
  const params = {
    threadId: "thread-1",
    serverName: "github",
    mode: "form",
    message: "Choose a repository",
    requestedSchema: {
      type: "object",
      properties: { repository: { type: "string" } },
      required: ["repository"],
    },
    _meta: { source: "test" },
  };
  const event = normalizeNativeRequest("request-1", "mcpServer/elicitation/request", params, create);
  assert.equal(event.type, "input_requested");
  if (event.type !== "input_requested") return;
  assert.equal(event.prompt, "Choose a repository");
  assert.deepEqual(event.requestSchema, {
    mode: "form",
    serverName: "github",
    requestedSchema: params.requestedSchema,
    metadata: params._meta,
  });
  assert.deepEqual(mapNativeInputResponse(
    { method: "mcpServer/elicitation/request", params },
    { outcome: "submitted", content: { repository: "nanthai" } },
  ), {
    action: "accept",
    content: { repository: "nanthai" },
    _meta: null,
  });
});

test("keeps URL elicitation distinct and never treats it as form content", () => {
  const params = {
    threadId: "thread-1",
    serverName: "oauth-server",
    mode: "url",
    message: "Open the authorization page",
    url: "https://example.test/authorize",
    elicitationId: "elicit-1",
    _meta: { external: true },
  };
  const event = normalizeNativeRequest("request-2", "mcpServer/elicitation/request", params, create);
  assert.equal(event.type, "input_requested");
  if (event.type !== "input_requested") return;
  assert.deepEqual(event.requestSchema, {
    mode: "url",
    serverName: "oauth-server",
    url: "https://example.test/authorize",
    elicitationId: "elicit-1",
    metadata: params._meta,
  });
  assert.deepEqual(mapNativeInputResponse(
    { method: "mcpServer/elicitation/request", params },
    { outcome: "submitted", content: { accidental: "form-value" } },
  ), { action: "accept", content: null, _meta: null });
  assert.deepEqual(mapNativeInputResponse(
    { method: "mcpServer/elicitation/request", params },
    { outcome: "cancelled", content: null },
  ), { action: "cancel", content: null, _meta: null });
});

test("maps request_user_input secret paths and answer shape", () => {
  const params = {
    questions: [{ id: "token", header: "Token", question: "Enter token", isSecret: true }],
  };
  const event = normalizeNativeRequest("request-3", "item/tool/requestUserInput", params, create);
  assert.equal(event.type, "input_requested");
  if (event.type !== "input_requested") return;
  assert.deepEqual(event.sensitiveFieldPaths, ["answers.token"]);
  assert.deepEqual(mapNativeInputResponse(
    { method: "item/tool/requestUserInput", params },
    { outcome: "submitted", content: { answers: { token: "secret" } } },
  ), { answers: { token: { answers: ["secret"] } } });
});


test("preserves explicit blocking classification for the unanswered-question policy", () => {
  for (const isBlocking of [true, false]) {
    const event = normalizeNativeRequest("question", "item/tool/requestUserInput", {
      isBlocking, questions: [{ id: "layout", question: "Which layout?", isSecret: false }],
    }, create);
    assert.equal(event.type, "input_requested");
    if (event.type === "input_requested") assert.equal((event.requestSchema as { isBlocking: boolean }).isBlocking, isBlocking);
  }
});
