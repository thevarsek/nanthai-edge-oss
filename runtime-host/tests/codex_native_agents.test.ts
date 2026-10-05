import assert from "node:assert/strict";
import test from "node:test";

import { canonicalCodexCapabilities } from "../src/canonical_capabilities.ts";
import { APP_SERVER_CAPABILITIES } from "../src/codex_capabilities.ts";
import { CodexEventNormalizer } from "../src/codex_event_normalizer.ts";
import type { CodexTransportEvent, CodexTransportSession } from "../src/codex_transport.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

test("advertises native child visibility only on the pinned App Server path", () => {
  const app = canonicalCodexCapabilities(APP_SERVER_CAPABILITIES).eventTypes;
  assert.equal(app.includes("native_agent_started"), true);
  assert.equal(app.includes("native_agent_activity"), true);
  assert.equal(app.includes("native_agent_status"), true);
});

test("projects pinned v2 child lifecycle backstage without ending the root turn", () => {
  const normalizer = createNormalizer();
  const first = normalizer.normalize(subAgentStarted());
  const initiallyObserved = first.find((event) => event.type === "native_agent_started");
  assert.ok(initiallyObserved?.type === "native_agent_started");
  assert.deepEqual({
    parent: initiallyObserved.parentNativeThreadId,
    depth: initiallyObserved.depth,
    path: initiallyObserved.agentPath,
    nickname: initiallyObserved.nickname,
  }, { parent: "root-thread-1", depth: 1, path: "/root/scout", nickname: null });
  assert.equal(first.some((event) => event.type === "text_delta"), false);
  const running = first.find((event) => event.type === "native_agent_status");
  assert.equal(running?.type === "native_agent_status" ? running.status : null, "running");

  assert.deepEqual(normalizer.normalize(notification("thread/status/changed", {
    threadId: "child-thread-1", status: { type: "idle" },
  })), []);
  const active = normalizer.normalize(notification("thread/status/changed", {
    threadId: "child-thread-1", status: { type: "active", activeFlags: [] },
  }));
  assert.equal(active[0]?.type === "native_agent_status" ? active[0].status : null, "running");

  const childEvents = [
    ...normalizer.normalize(notification("turn/started", {
      threadId: "child-thread-1",
      turn: { id: "child-turn-1", status: "inProgress", items: [] },
    })),
    ...normalizer.normalize(notification("item/started", {
      threadId: "child-thread-1", turnId: "child-turn-1",
      item: { type: "agentMessage", id: "child-message-1", text: "", phase: "final_answer" },
    })),
    ...normalizer.normalize(notification("item/agentMessage/delta", {
      threadId: "child-thread-1",
      turnId: "child-turn-1",
      itemId: "child-message-1",
      delta: "Child result stays backstage",
    })),
    ...normalizer.normalize(notification("item/completed", {
      threadId: "child-thread-1",
      turnId: "child-turn-1",
      item: {
        type: "agentMessage", id: "child-message-1",
        text: "Child result stays backstage", phase: "final_answer",
      },
    })),
    ...normalizer.normalize(notification("thread/status/changed", {
      threadId: "child-thread-1", status: { type: "idle" },
    })),
  ];
  assert.equal(childEvents.some((event) => event.type === "terminal"), false);
  assert.equal(childEvents.some((event) => event.type === "text_delta"), false);
  assert.equal(childEvents.some((event) => event.type === "native_agent_status"
    && event.status === "completed"), false);
  const activity = childEvents.find((event) => event.type === "native_agent_activity");
  assert.equal(activity?.type === "native_agent_activity" ? activity.summary : null,
    "Child result stays backstage");
  const childCompletion = normalizer.normalize(notification("turn/completed", {
    threadId: "child-thread-1",
    turn: { id: "child-turn-1", status: "completed", items: [] },
  }));
  const childTerminal = childCompletion.at(-1);
  assert.equal(childTerminal?.type, "native_agent_status");
  assert.equal(childTerminal?.type === "native_agent_status"
    ? childTerminal.status : null, "completed");

  const rootText = normalizer.normalize(notification("item/agentMessage/delta", {
    threadId: "root-thread-1",
    turnId: "root-turn-1",
    itemId: "root-message-1",
    delta: "Root final answer",
  }));
  assert.equal(rootText[0]?.type, "text_delta");
  const terminal = normalizer.normalize(notification("turn/completed", {
    threadId: "root-thread-1",
    turn: { id: "root-turn-1", status: "completed", items: [] },
  }));
  assert.equal(terminal[0]?.type, "terminal");
});

test("enriches an observed child if App Server later reports thread metadata", () => {
  const normalizer = createNormalizer();
  normalizer.normalize(subAgentStarted());
  const observed = normalizer.normalize(childThreadStarted())
    .find((event) => event.type === "native_agent_started");
  assert.ok(observed?.type === "native_agent_started");
  assert.deepEqual({
    root: observed.rootNativeThreadId, parent: observed.parentNativeThreadId,
    depth: observed.depth, path: observed.agentPath, nickname: observed.nickname,
    role: observed.role, model: observed.actualModel, reasoning: observed.reasoningEffort,
  }, {
    root: "root-thread-1", parent: "root-thread-1", depth: 1, path: "scout",
    nickname: "Scout", role: "reviewer", model: null, reasoning: null,
  });
});

test("retains the requested child model when a collab tool call reports it", () => {
  const normalizer = createNormalizer();
  normalizer.normalize(collabStarted());
  const observed = normalizer.normalize(childThreadStarted())
    .find((event) => event.type === "native_agent_started");
  assert.deepEqual(observed?.type === "native_agent_started" ? observed.actualModel : null,
    { provider: "openai", modelId: "gpt-child", reportedByAdapter: true });
});

test("attributes native child permission and input requests to the parent-gated child", () => {
  const normalizer = createNormalizer();
  normalizer.normalize(subAgentStarted());
  normalizer.normalize(childThreadStarted());

  const permission = normalizer.normalize({
    type: "server_request",
    requestId: "approval-1",
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "child-thread-1",
      turnId: "child-turn-1",
      itemId: "command-1",
      command: "printf child",
    },
  })[0];
  assert.equal(permission?.type === "permission_requested"
    ? permission.nativeAgentThreadId : null, "child-thread-1");

  const input = normalizer.normalize({
    type: "server_request",
    requestId: "input-1",
    method: "item/tool/requestUserInput",
    params: {
      threadId: "child-thread-1",
      turnId: "child-turn-1",
      itemId: "input-tool-1",
      questions: [{ id: "choice", question: "Choose" }],
    },
  })[0];
  assert.equal(input?.type === "input_requested" ? input.nativeAgentThreadId : null,
    "child-thread-1");

  const rootPermission = normalizer.normalize({
    type: "server_request",
    requestId: "approval-root",
    method: "item/fileChange/requestApproval",
    params: { threadId: "root-thread-1", itemId: "file-1" },
  })[0];
  assert.equal(rootPermission?.type === "permission_requested"
    ? rootPermission.nativeAgentThreadId : "missing", null);
});

test("fails closed for unknown notifications on registered child threads", () => {
  const normalizer = createNormalizer();
  normalizer.normalize(collabStarted());
  normalizer.normalize(childThreadStarted());
  assert.throws(() => normalizer.normalize(notification("child/unknown", {
    threadId: "child-thread-1",
  })), /Unsupported child App Server notification/);
});

test("reports child usage separately without substituting the parent model", () => {
  for (const knownModel of [true, false]) {
    const normalizer = createNormalizer();
    normalizer.normalize(knownModel ? collabStarted() : subAgentStarted());
    const events = normalizer.normalize(notification("thread/tokenUsage/updated", {
      threadId: "child-thread-1",
      tokenUsage: { last: { inputTokens: 27623, outputTokens: 8,
        cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 27631 } },
    }));
    const usage = events.find(event => event.type === "usage_reported");
    assert.ok(usage?.type === "usage_reported");
    assert.equal(usage.nativeAgentThreadId, "child-thread-1");
    assert.equal(usage.tokens.total, 27631);
    assert.equal(usage.cost.source, "unpriced");
    assert.deepEqual(usage.actualModel, knownModel
      ? { provider: null, modelId: "gpt-child", reportedByAdapter: true } : null);
    assert.equal(events.some(event => event.type === "terminal"), false);
  }
});

function createNormalizer(): CodexEventNormalizer {
  return new CodexEventNormalizer(runtimePacket(), "session-1", appSession(), () => 1);
}

function appSession(): CodexTransportSession {
  return {
    transport: "app_server_stdio",
    nativeSessionId: "root-thread-1",
    model: "gpt-root",
    provider: "openai",
    workingDirectory: null,
  };
}

function collabStarted(): CodexTransportEvent {
  return notification("item/started", {
    threadId: "root-thread-1",
    turnId: "root-turn-1",
    item: {
      type: "collabAgentToolCall",
      id: "spawn-1",
      tool: "spawnAgent",
      status: "inProgress",
      senderThreadId: "root-thread-1",
      receiverThreadIds: ["child-thread-1"],
      prompt: "Inspect the runtime file",
      model: "gpt-child",
      reasoningEffort: "high",
      agentsStates: { "child-thread-1": { status: "pendingInit", message: null } },
    },
  });
}

function subAgentStarted(): CodexTransportEvent {
  return notification("item/started", {
    threadId: "root-thread-1",
    turnId: "root-turn-1",
    item: {
      type: "subAgentActivity",
      id: "spawn-activity-1",
      kind: "started",
      agentThreadId: "child-thread-1",
      agentPath: "/root/scout",
    },
  });
}

function childThreadStarted(): CodexTransportEvent {
  return notification("thread/started", { thread: {
    id: "child-thread-1",
    sessionId: "root-thread-1",
    parentThreadId: "root-thread-1",
    modelProvider: "openai",
    status: { type: "active", activeFlags: [] },
    agentNickname: "Scout",
    agentRole: "reviewer",
    source: { subAgent: { thread_spawn: {
      parent_thread_id: "root-thread-1",
      depth: 1,
      agent_path: "scout",
      agent_nickname: "Scout",
      agent_role: "reviewer",
    } } },
  } });
}

function notification(method: string, params: unknown): CodexTransportEvent {
  return { type: "notification", method, params };
}
