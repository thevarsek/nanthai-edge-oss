import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import {
  createPermissionFixture,
  permissionHost,
} from "./runtime_host_permission_fixture";

test("the fenced host ingestion path routes native child events into their projection", async () => {
  const state = await createPermissionFixture();
  assert.equal(await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: workerNativeAgentStarted(state.now),
  }), true);
  assert.equal(state.rows.runtimeNativeAgentGroups.length, 1);
  assert.equal(state.rows.runtimeNativeAgents.length, 1);
  assert.equal(
    state.rows.messages[0].runtimeNativeAgentGroupId,
    state.rows.runtimeNativeAgentGroups[0]._id,
  );
  assert.equal(state.rows.runtimeNativeAgents[0].nativeThreadId, "child-thread-1");
  assert.equal(state.rows.runEvents[0].type, "model_activity");
  assert.equal(state.rows.runEvents[0].summary, "Codex started a native agent");
});

function workerNativeAgentStarted(now: number) {
  return {
    eventId: "turn-1:worker:0",
    commandRecordId: "command-1" as Id<"runtimeCommands">,
    commandId: "turn-1",
    runId: "run-1" as Id<"executionRuns">,
    attemptId: "attempt-1" as Id<"executionAttempts">,
    fence: 7,
    kind: "worker_message" as const,
    emittedAtMs: now,
    payload: {
      wireVersion: "nanthai.runtime.process.v1",
      messageId: "worker-0",
      sequence: 0,
      sentAt: now,
      kind: "adapter_event" as const,
      payload: {
        sessionId: "root-session-1",
        event: {
          protocolVersion: "nanthai.runtime.v1",
          eventId: "native-agent-started-1",
          sequence: 0,
          occurredAt: now,
          runId: "run-1",
          attemptId: "attempt-1",
          fence: 7,
          sessionId: "root-session-1",
          type: "native_agent_started",
          nativeThreadId: "child-thread-1",
          rootNativeThreadId: "root-thread-1",
          parentNativeThreadId: "root-thread-1",
          depth: 1,
          agentPath: "agents/reviewer",
          nickname: "Reviewer",
          role: "Code review",
          prompt: "Review this change",
          actualModel: null,
          reasoningEffort: null,
        },
      },
    },
  };
}
