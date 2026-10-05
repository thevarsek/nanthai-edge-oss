import assert from "node:assert/strict";
import test from "node:test";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import {
  fixture, oldHost, restartedHost, workerEvent, hostFailure, restart,
} from "./runtime_host_event_replay_fixture";

function adapterEvent(sequence: number, fields: Record<string, unknown>) {
  const event = workerEvent(sequence, "terminal_event");
  return {
    ...event,
    payload: {
      ...event.payload,
      kind: "adapter_event",
      payload: {
        sessionId: "attempt-1",
        event: {
          protocolVersion: "nanthai.runtime.v1", eventId: `adapter-${sequence}`,
          sequence, occurredAt: Date.now(), runId: "run-1", attemptId: "attempt-1",
          fence: 7, sessionId: "attempt-1", ...fields,
        },
      },
    },
  };
}

async function recoveryFixture() {
  const state = await fixture();
  state.rows.executionAttempts[0].leaseExpiresAt = state.now - 1;
  restart(state.rows, state.now);
  return state;
}

test("unchanged credential replays an expired original attempt through binding, text and terminal exactly once", async () => {
  const { ctx, rows } = await recoveryFixture();
  Object.assign(rows.executionAttempts[0], {
    chatParticipantId: "participant-1", routeSnapshotHash: "route-1",
  });
  rows.chatParticipants = [{
    _id: "participant-1", userId: "user-1", chatId: "chat-1", personaId: "persona-1",
  }];
  rows.personas = [{ _id: "persona-1", userId: "user-1", displayName: "Local" }];
  const originalOwner = rows.executionAttempts[0].claimantId;
  const originalLease = rows.executionAttempts[0].leaseExpiresAt;
  const events = [
    adapterEvent(5, {
      type: "session_started", nativeSessionId: "native-1", resumed: false,
      workingDirectory: "/tmp/qa", repository: null,
    }),
    adapterEvent(6, { type: "text_delta", messageId: "message-1", delta: " recovered" }),
    adapterEvent(7, { type: "reasoning_delta", delta: "Recovered reasoning" }),
    adapterEvent(8, {
      type: "tool_completed", toolCallId: "tool-1", toolName: "publish",
      outcome: "completed", summary: "Already completed", artifactIds: ["artifact-1"],
    }),
  ];
  for (const event of events) {
    assert.equal(await ingestRuntimeEventHandler(ctx, { ...restartedHost, event }), true);
    assert.equal(await ingestRuntimeEventHandler(ctx, { ...restartedHost, event }), true);
  }
  assert.equal(rows.streamingMessages[0].content, "Canonical answer recovered");
  assert.equal(rows.streamingMessages[0].reasoning, "Recovered reasoning");
  assert.equal(rows.runtimeConversationBindings.length, 1);
  assert.equal(rows.runtimeSessionBindings.length, 1);
  assert.equal(rows.executionAttempts[0].claimantId, originalOwner);
  assert.equal(rows.executionAttempts[0].leaseExpiresAt, originalLease);
  const terminal = workerEvent(9, "terminal_event");
  assert.equal(await ingestRuntimeEventHandler(ctx, { ...restartedHost, event: terminal }), true);
  assert.equal(rows.messages[0].content, "Canonical answer recovered");
  assert.equal(rows.messages[0].status, "completed");
  assert.equal(rows.executionRuns[0].state, "completed");
  assert.equal(rows.runtimeCommands[0].status, "completed");
  assert.equal(rows.runtimeSessionBindings[0].status, "released");
  const count = rows.runEvents.length;
  assert.equal(await ingestRuntimeEventHandler(ctx, { ...restartedHost, event: terminal }), true);
  assert.equal(rows.runEvents.length, count);
});

test("restart replays host failure against its original expired owner", async () => {
  const { ctx, rows } = await recoveryFixture();
  assert.equal(await ingestRuntimeEventHandler(ctx, { ...restartedHost, event: hostFailure() }), true);
  assert.equal(rows.messages[0].status, "failed");
  assert.equal(rows.executionRuns[0].state, "failed");
  assert.equal(rows.runtimeCommands[0].status, "rejected");
});

test("replay cannot reopen stopped, replaced, terminal, revoked or deleting executions", async () => {
  const cases: Array<[string, (rows: Awaited<ReturnType<typeof fixture>>["rows"]) => void]> = [
    ["STALE_EXECUTION_ATTEMPT", rows => { rows.executionRuns[0].activeAttemptId = "replacement"; }],
    ["TERMINAL_EXECUTION_RUN", rows => { rows.executionRuns[0].state = "failed"; }],
    ["TERMINAL_EXECUTION_ATTEMPT", rows => { rows.executionAttempts[0].status = "superseded"; }],
    ["RUNTIME_EVENT_EXECUTION_MISMATCH", rows => { rows.executionAttempts[0].fence = 8; }],
    ["EXECUTION_CLAIMANT_MISMATCH", rows => { rows.executionAttempts[0].claimantId = "replacement"; }],
    ["UNAUTHORIZED", rows => { rows.runtimeDeviceCredentials[0].status = "revoked"; }],
    ["EXECUTION_CHAT_DELETING", rows => { rows.chats[0].isDeleting = true; }],
    ["EXECUTION_OWNER_DELETING", rows => { rows.accountDeletionTombstones.push({ userId: "user-1" }); }],
  ];
  for (const [error, change] of cases) {
    const { ctx, rows } = await recoveryFixture();
    change(rows);
    await assert.rejects(ingestRuntimeEventHandler(ctx, {
      ...restartedHost, event: adapterEvent(5, { type: "text_delta", messageId: "message-1", delta: " forbidden" }),
    }), new RegExp(error));
    assert.equal(rows.streamingMessages[0].content, "Canonical answer");
    assert.equal(rows.executionAttempts[0].runtimeLastWorkerSequence, 4);
  }
  const cancelled = await recoveryFixture();
  cancelled.rows.executionRuns[0].state = "cancelling";
  cancelled.rows.generationJobs[0].status = "cancelled";
  await ingestRuntimeEventHandler(cancelled.ctx, {
    ...restartedHost, event: adapterEvent(5, { type: "text_delta", messageId: "message-1", delta: " forbidden" }),
  });
  assert.equal(cancelled.rows.streamingMessages[0].content, "Canonical answer");
  assert.equal(cancelled.rows.executionRuns[0].state, "cancelling");
});

test("an expired current presence cannot use restart replay to extend its lease", async () => {
  const { ctx, rows, now } = await fixture();
  rows.executionAttempts[0].leaseExpiresAt = now - 1;
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    ...oldHost, event: workerEvent(5, "terminal_event"),
  }), /EXECUTION_LEASE_EXPIRED/);
});
