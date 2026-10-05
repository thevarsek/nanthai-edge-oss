import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { applyRuntimeNativeAgentEvent } from
  "../runtime_host/native_agent_ingestion";
import {
  closeNativeAgentChildrenHandler,
  closeRuntimeNativeAgentGroupForAttempt,
} from "../runtime_host/native_agent_lifecycle";
import { getNativeAgentsForMessageHandler } from "../runtime_host/native_agents";
import type { NonTerminalAdapterEvent } from
  "../runtime_host/protocol_adapter_events";
import type { RuntimeChatEventContext } from
  "../runtime_host/chat_terminal_ingestion";

type Rows = Record<string, Array<Record<string, unknown>>>;
type NativeEvent = Extract<
  NonTerminalAdapterEvent,
  { type: "native_agent_started" | "native_agent_activity" | "native_agent_status" }
>;

function fixture() {
  const rows: Rows = {
    chats: [{ _id: "chat-1", userId: "user-1", title: "Native agents" }],
    messages: [{
      _id: "message-1", userId: "user-1", chatId: "chat-1",
      role: "assistant", content: "", status: "streaming", createdAt: 1,
    }],
    generationJobs: [{
      _id: "job-1", userId: "user-1", chatId: "chat-1",
      messageId: "message-1", status: "streaming", createdAt: 1,
    }],
    executionRuns: [{
      _id: "run-1", userId: "user-1", chatId: "chat-1",
      generationJobId: "job-1", kind: "chat_generation", state: "running",
      requestedPlacement: "local", activeAttemptId: "attempt-1",
      nextAttemptNumber: 2, nextEventSequence: 0, createdAt: 1, updatedAt: 1,
    }],
    executionAttempts: [{
      _id: "attempt-1", runId: "run-1", userId: "user-1",
      attemptNumber: 1, executorKind: "local_runtime", placement: "local",
      adapterId: "codex", protocolVersion: "nanthai.runtime.v1",
      status: "running", fence: 7, createdAt: 1, updatedAt: 1,
    }],
    runtimeNativeAgentGroups: [],
    runtimeNativeAgents: [],
  };
  const ctx = createStatefulMockCtx(rows);
  const context = {
    host: {
      credential: { _id: "credential-1" },
      device: { _id: "device-1" },
      claimantId: "runtime-host:device-1:presence-1",
    },
    run: rows.executionRuns[0],
    attempt: rows.executionAttempts[0],
    job: rows.generationJobs[0],
    command: { _id: "command-1" },
  } as unknown as RuntimeChatEventContext;
  return { ctx, rows, context };
}

const base = {
  protocolVersion: "nanthai.runtime.v1" as const,
  eventId: "event-1",
  sequence: 1,
  occurredAt: 100,
  runId: "run-1",
  attemptId: "attempt-1",
  fence: 7,
  sessionId: "root-session-1",
};

function started(
  nativeThreadId: string,
  overrides: Partial<Extract<NativeEvent, { type: "native_agent_started" }>> = {},
): Extract<NativeEvent, { type: "native_agent_started" }> {
  return {
    ...base,
    type: "native_agent_started",
    nativeThreadId,
    rootNativeThreadId: "root-thread-1",
    parentNativeThreadId: "root-thread-1",
    depth: 1,
    agentPath: `agents/${nativeThreadId}`,
    nickname: "Reviewer",
    role: "reviewer",
    prompt: "Review the bounded change",
    actualModel: null,
    reasoningEffort: null,
    ...overrides,
  };
}

test("native Codex agents materialize separately and project without private session state", async () => {
  const { ctx, rows, context } = fixture();
  await applyRuntimeNativeAgentEvent(
    ctx as unknown as MutationCtx,
    context,
    started("child-1"),
  );
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, {
    ...base,
    eventId: "event-2",
    sequence: 2,
    occurredAt: 110,
    type: "native_agent_activity",
    nativeThreadId: "child-1",
    activityId: "activity-1",
    kind: "message",
    summary: "The focused review ",
  });
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, {
    ...base,
    eventId: "event-2b",
    sequence: 3,
    occurredAt: 115,
    type: "native_agent_activity",
    nativeThreadId: "child-1",
    activityId: "activity-1",
    kind: "message",
    summary: "found no defect.",
  });
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, {
    ...base,
    eventId: "event-3",
    sequence: 3,
    occurredAt: 120,
    type: "native_agent_status",
    nativeThreadId: "child-1",
    status: "completed",
    summary: "Review completed",
    actualModel: {
      provider: null,
      modelId: "gpt-5.6-luna",
      reportedByAdapter: true,
    },
    reasoningEffort: "high",
  });

  const group = rows.runtimeNativeAgentGroups[0];
  assert.equal(rows.messages[0].runtimeNativeAgentGroupId, group._id);
  assert.equal(group.rootNativeSessionId, "root-session-1");
  assert.equal(rows.runtimeNativeAgents[0].output, "The focused review found no defect.");
  assert.equal(rows.runtimeNativeAgents[0].status, "completed");

  const view = await getNativeAgentsForMessageHandler(ctx as unknown as QueryCtx, {
    userId: "user-1",
    messageId: "message-1" as Id<"messages">,
  });
  assert.equal(view?.origin, "codex_native_agent");
  assert.equal(view?.agents[0].actualModel?.modelId, "gpt-5.6-luna");
  assert.equal(view?.agents[0].actualModel?.provider, undefined);
  assert.equal(view?.agents[0].reasoningEffort, "high");
  assert.equal(view && "rootNativeSessionId" in view.group, false);
  assert.equal(await getNativeAgentsForMessageHandler(ctx as unknown as QueryCtx, {
    userId: "user-2",
    messageId: "message-1" as Id<"messages">,
  }), null);
});

test("same native activity chunks accumulate without splitting the 4,000-unit bound", async () => {
  const { ctx, rows, context } = fixture();
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, started("child-1"));
  const chunks = ["A".repeat(2_000), `${"B".repeat(1_998)}😀`, "ignored"];
  for (const [index, summary] of chunks.entries()) {
    await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, {
      ...base,
      eventId: `chunk-${index}`,
      sequence: index + 2,
      occurredAt: 110 + index,
      type: "native_agent_activity",
      nativeThreadId: "child-1",
      activityId: "streamed-message-1",
      kind: "message",
      summary,
    });
  }
  const output = rows.runtimeNativeAgents[0].output as string;
  assert.equal(output.length, 4_000);
  assert.equal(output.endsWith("😀"), true);
  assert.equal(output.includes("ignored"), false);
  assert.equal(rows.runtimeNativeAgents[0].latestActivity, output);
});

test("a repeated native start enriches one child without reopening a terminal status", async () => {
  const { ctx, rows, context } = fixture();
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, started("child-1", {
    agentPath: null, nickname: null, role: null, prompt: null,
  }));
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, {
    ...base,
    eventId: "status-1", sequence: 2, occurredAt: 110,
    type: "native_agent_status", nativeThreadId: "child-1",
    status: "completed", summary: "Done", actualModel: null, reasoningEffort: null,
  });
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, started("child-1", {
    eventId: "enrichment-1", sequence: 3, occurredAt: 120,
    agentPath: "agents/reviewer", nickname: "Reviewer", role: "reviewer",
    prompt: "Review the bounded change", reasoningEffort: "high",
  }));

  assert.equal(rows.runtimeNativeAgentGroups.length, 1);
  assert.equal(rows.runtimeNativeAgents.length, 1);
  assert.equal(rows.runtimeNativeAgentGroups[0].nextAgentOrdinal, 1);
  assert.equal(rows.runtimeNativeAgents[0].nickname, "Reviewer");
  assert.equal(rows.runtimeNativeAgents[0].role, "reviewer");
  assert.equal(rows.runtimeNativeAgents[0].reasoningEffort, "high");
  assert.equal(rows.runtimeNativeAgents[0].status, "completed");
});

test("parent cancellation preserves settled children and interrupts active descendants", async () => {
  const { ctx, rows, context } = fixture();
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, started("child-1"));
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, started("child-2", {
    eventId: "event-2", sequence: 2, occurredAt: 110, nickname: "Implementer",
  }));
  await applyRuntimeNativeAgentEvent(ctx as unknown as MutationCtx, context, {
    ...base,
    eventId: "event-3", sequence: 3, occurredAt: 120,
    type: "native_agent_status", nativeThreadId: "child-1",
    status: "completed", summary: "Done", actualModel: null, reasoningEffort: null,
  });
  await closeRuntimeNativeAgentGroupForAttempt(ctx as unknown as MutationCtx, {
    attemptId: "attempt-1" as Id<"executionAttempts">,
    fence: 7,
    outcome: "cancelled",
    now: 130,
  });
  assert.equal(rows.runtimeNativeAgentGroups[0].status, "cancelled");
  assert.equal(rows.runtimeNativeAgents[0].status, "completed");
  assert.equal(rows.runtimeNativeAgents[1].status, "interrupted");
  assert.equal(ctx.scheduled.length, 0);
});

test("terminal descendant cleanup and the public view stay bounded", async () => {
  const { ctx, rows } = fixture();
  rows.runtimeNativeAgentGroups.push({
    _id: "group-1", userId: "user-1", chatId: "chat-1", messageId: "message-1",
    generationJobId: "job-1", runId: "run-1", attemptId: "attempt-1", fence: 7,
    adapterId: "codex", rootNativeSessionId: "session-1",
    rootNativeThreadId: "root-1", status: "cancelled", nextAgentOrdinal: 101,
    startedAt: 1, updatedAt: 1, completedAt: 200,
  });
  rows.messages[0].runtimeNativeAgentGroupId = "group-1";
  for (let ordinal = 0; ordinal < 101; ordinal += 1) {
    rows.runtimeNativeAgents.push({
      _id: `agent-${ordinal}`, groupId: "group-1", userId: "user-1",
      chatId: "chat-1", messageId: "message-1", nativeThreadId: `child-${ordinal}`,
      ordinal, depth: 1, status: "running", startedAt: ordinal, updatedAt: ordinal,
    });
  }
  const view = await getNativeAgentsForMessageHandler(ctx as unknown as QueryCtx, {
    userId: "user-1",
    messageId: "message-1" as Id<"messages">,
  });
  assert.equal(view?.agents.length, 100);
  assert.equal(view?.agentsTruncated, true);

  assert.equal(await closeNativeAgentChildrenHandler(ctx as unknown as MutationCtx, {
    groupId: "group-1" as Id<"runtimeNativeAgentGroups">,
    groupStatus: "cancelled",
    childStatus: "interrupted",
    statusSummary: "Parent runtime cancelled",
    now: 200,
  }), false);
  assert.equal(rows.runtimeNativeAgents.filter((agent) => agent.status === "running").length, 1);
  assert.equal(ctx.scheduled.length, 1);
  assert.equal(await closeNativeAgentChildrenHandler(ctx as unknown as MutationCtx, {
    groupId: "group-1" as Id<"runtimeNativeAgentGroups">,
    groupStatus: "cancelled",
    childStatus: "interrupted",
    statusSummary: "Parent runtime cancelled",
    now: 200,
  }), true);
  assert.equal(rows.runtimeNativeAgents.some((agent) => agent.status === "running"), false);
});
