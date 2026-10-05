import assert from "node:assert/strict";
import test from "node:test";

import { CodexEventNormalizer } from "../src/codex_event_normalizer.ts";
import type { CodexTransportSession } from "../src/codex_transport.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

test("keeps App Server total input and cached subset as separate dimensions", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  const events = normalizer.normalize({
    type: "notification",
    method: "thread/tokenUsage/updated",
    params: {
      tokenUsage: {
        last: {
          inputTokens: 1200,
          cachedInputTokens: 400,
          outputTokens: 300,
          reasoningOutputTokens: 50,
          totalTokens: 1500,
        },
      },
    },
  });
  const usage = events[0];
  assert.equal(usage?.type, "usage_reported");
  if (usage?.type !== "usage_reported") return;
  assert.deepEqual(usage.tokens, {
    input: 1200, output: 300, cachedInput: 400, reasoning: 50, total: 1500,
  });
  assert.deepEqual(usage.actualModel, {
    provider: "openai", modelId: "gpt-test", reportedByAdapter: true,
  });
});

test("classifies MCP startup status as transport lifecycle, not a turn event", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  assert.deepEqual(normalizer.normalize({ type: "notification", method: "thread/goal/cleared", params: { threadId: "app-thread-1" } }), []);
  assert.deepEqual(normalizer.normalize({
    type: "notification",
    method: "mcpServer/startupStatus/updated",
    params: {
      threadId: "app-thread-1",
      server: "example",
      status: "ready",
    },
  }), []);
  assert.deepEqual(normalizer.normalize({
    type: "notification",
    method: "thread/status/changed",
    params: { threadId: "app-thread-1", status: { type: "active" } },
  }), []);
  assert.deepEqual(normalizer.normalize({
    type: "notification",
    method: "serverRequest/resolved",
    params: { threadId: "app-thread-1", requestId: "approval-1" },
  }), []);
  assert.throws(() => normalizer.normalize({
    type: "notification",
    method: "unknown/lifecycle/event",
    params: { threadId: "app-thread-1" },
  }), /Unsupported App Server notification/);
});

test("does not repeat App Server item completions after item deltas", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  const text = normalizer.normalize({
    type: "notification",
    method: "item/agentMessage/delta",
    params: { itemId: "message-1", delta: "streamed answer" },
  });
  const reasoning = normalizer.normalize({
    type: "notification",
    method: "item/reasoning/summaryTextDelta",
    params: { itemId: "reasoning-1", delta: "streamed reasoning" },
  });

  assert.equal(text[0]?.type === "text_delta" ? text[0].delta : null, "streamed answer");
  assert.equal(reasoning[0]?.type === "reasoning_delta" ? reasoning[0].delta : null,
    "streamed reasoning");
  assert.deepEqual(normalizer.normalize({
    type: "notification",
    method: "item/completed",
    params: { item: { id: "message-1", type: "agentMessage", text: "streamed answer" } },
  }), []);
  assert.deepEqual(normalizer.normalize({
    type: "notification",
    method: "item/completed",
    params: { item: { id: "reasoning-1", type: "reasoning", text: "streamed reasoning" } },
  }), []);
});

test("Codex 0.159 hook, name and terminal metadata do not end root or child turns", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  normalizer.normalize({ type: "notification", method: "thread/started", params: {
    thread: { id: "child-1", parentThreadId: "app-thread-1" },
  } });
  for (const threadId of ["app-thread-1", "child-1"]) {
    assert.deepEqual(normalizer.normalize({ type: "notification",
      method: "item/commandExecution/terminalInteraction",
      params: { threadId, turnId: "native-1", itemId: "exec-1", processId: "123", stdin: "" },
    }), []);
    assert.deepEqual(normalizer.normalize({ type: "notification", method: "thread/name/updated",
      params: { threadId, threadName: "NanthAI · Continued work" },
    }), []);
    for (const method of ["hook/started", "hook/completed"]) {
      assert.deepEqual(normalizer.normalize({ type: "notification", method, params: {
        threadId, turnId: "native-1", run: {
          id: "hook-1", eventName: "userPromptSubmit", handlerType: "command",
          executionMode: "sync", scope: "turn", sourcePath: "/private/hook.json",
          displayOrder: 0, startedAt: 1, status: "completed",
          entries: [{ kind: "context", text: "private hook output" }],
        },
      } }), []);
    }
  }
  const terminal = normalizer.normalize({ type: "notification", method: "turn/completed",
    params: { threadId: "app-thread-1", turn: { id: "native-1", status: "failed", error: { message: "Native failure" } } },
  });
  assert.equal(terminal[0]?.type === "terminal" ? terminal[0].outcome : null, "failed");
});

test("uses App Server item completions when no item deltas were observed", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  const text = normalizer.normalize({
    type: "notification",
    method: "item/completed",
    params: { item: { id: "message-1", type: "agentMessage", text: "completed answer" } },
  });
  const reasoning = normalizer.normalize({
    type: "notification",
    method: "item/completed",
    params: { item: { id: "reasoning-1", type: "reasoning", summary: ["completed reasoning"] } },
  });

  assert.equal(text[0]?.type === "text_delta" ? text[0].delta : null, "completed answer");
  assert.equal(reasoning[0]?.type === "reasoning_delta" ? reasoning[0].delta : null,
    "completed reasoning");
});

test("logs each valid App Server warning once without emitting an adapter event", () => {
  const warnings: string[] = [];
  const normalizer = new CodexEventNormalizer(
    runtimePacket(), "session-1", appSession(), () => 1,
    (message) => warnings.push(message),
  );
  const knownWarning = {
    type: "notification" as const,
    method: "warning",
    params: {
      threadId: "app-thread-1",
      message: "Skill descriptions were shortened to fit the skills context budget.",
    },
  };
  assert.deepEqual(normalizer.normalize(knownWarning), []);
  assert.deepEqual(normalizer.normalize(knownWarning), []);
  assert.deepEqual(normalizer.normalize({
    type: "notification",
    method: "warning",
    params: { threadId: "app-thread-1", message: "A future Codex warning" },
  }), []);
  const unicodeWarning = `${"x".repeat(1_998)}😀tail`;
  assert.deepEqual(normalizer.normalize({
    type: "notification",
    method: "warning",
    params: { threadId: null, message: unicodeWarning },
  }), []);
  assert.deepEqual(warnings.slice(0, 2), [
    knownWarning.params.message,
    "A future Codex warning",
  ]);
  assert.equal(warnings[2]?.length, 2_000);
  assert.equal(warnings[2]?.endsWith("😀"), true);
  assert.equal(warnings.some((message) => message.includes("app-thread-1")), false);
  const throwingSink = new CodexEventNormalizer(
    runtimePacket(), "session-2", appSession(), () => 1,
    () => { throw new Error("local sink unavailable"); },
  );
  assert.deepEqual(throwingSink.normalize(knownWarning), []);
});

test("rejects malformed or cross-thread App Server warnings", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  assert.throws(() => normalizer.normalize({
    type: "notification",
    method: "warning",
    params: { threadId: "app-thread-1" },
  }), /omitted params\.message/);
  assert.throws(() => normalizer.normalize({
    type: "notification",
    method: "warning",
    params: { threadId: 42, message: "Malformed" },
  }), /invalid params\.threadId/);
  assert.throws(() => normalizer.normalize({
    type: "notification",
    method: "warning",
    params: { threadId: "another-thread", message: "Wrong thread" },
  }), /different thread/);
});

test("preserves numeric native request IDs behind canonical string IDs", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  const events = normalizer.normalize({
    type: "server_request",
    requestId: 0,
    method: "item/commandExecution/requestApproval",
    params: { itemId: "command-1", command: "touch harmless" },
  });
  assert.equal(events[0]?.type, "permission_requested");
  assert.equal(events[0]?.type === "permission_requested"
    ? events[0].permissionRequestId : null, "0");
  assert.equal(normalizer.nativeRequestId("0"), 0);
  assert.deepEqual(normalizer.nativePermissionResponse("0", "deny"), { decision: "decline" });
});

function appSession(): CodexTransportSession {
  return {
    transport: "app_server_stdio",
    nativeSessionId: "app-thread-1",
    model: "gpt-test",
    provider: "openai",
    workingDirectory: null,
  };
}

test("Codex web search with an initially empty query does not interrupt the turn", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  const started = normalizer.normalize({ type: "notification", method: "item/started",
    params: { item: { id: "search-1", type: "webSearch", query: "" } },
  });
  assert.equal(started[0]?.type, "tool_started");
  assert.equal(started[0]?.type === "tool_started" ? started[0].summary : null, "Web search started");
  const completed = normalizer.normalize({ type: "notification", method: "item/completed",
    params: { item: { id: "search-1", type: "webSearch", query: "Tower of London official website" } },
  });
  assert.equal(completed[0]?.type === "tool_completed" ? completed[0].outcome : null, "completed");
  const answer = normalizer.normalize({ type: "notification", method: "item/completed",
    params: { item: { id: "message-1", type: "agentMessage", text: "https://www.hrp.org.uk/tower-of-london/" } },
  });
  assert.equal(answer[0]?.type, "text_delta");
  const terminal = normalizer.normalize({ type: "notification", method: "turn/completed",
    params: { turn: { id: "native-1", status: "completed" } },
  });
  assert.equal(terminal[0]?.type === "terminal" ? terminal[0].outcome : null, "completed");
});

test("keeps the real native turn ID separate from the canonical terminal event ID", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  const events = normalizer.normalize({
    type: "notification", method: "turn/completed",
    params: { threadId: "thread-1", turn: { id: "native-turn-42", status: "completed" } },
  });
  const terminal = events.find((event) => event.type === "terminal");
  assert.ok(terminal?.type === "terminal");
  assert.equal(terminal.nativeTurnId, "native-turn-42");
  assert.notEqual(terminal.eventId, terminal.nativeTurnId);
});


test("native errors preserve failure details and retry notifications keep the turn open", () => {
  const normalizer = new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
  const failure = { error: { message: "This model requires a newer Codex version" }, turnId: "native-1" };
  assert.deepEqual(normalizer.normalize({ type: "notification", method: "error", params: { ...failure, willRetry: true } }), []);
  const events = normalizer.normalize({ type: "notification", method: "error", params: { ...failure, willRetry: false } });
  assert.equal(events[0]?.type, "terminal");
  if (events[0]?.type !== "terminal") return;
  assert.equal(events[0].outcome, "failed");
  assert.equal(events[0].summary, failure.error.message);
  assert.equal(events[0].nativeTurnId, "native-1");
  assert.deepEqual(normalizer.normalize({ type: "notification", method: "turn/completed", params: { turn: { id: "native-1", status: "failed" } } }), []);
});
