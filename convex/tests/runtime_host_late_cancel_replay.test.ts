import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { sha256Hex } from "../runtime_host/security";

type Rows = Record<string, Array<Record<string, unknown>>>;

const restartedHost = {
  deviceId: "device-live",
  credentialId: "credential-live",
  credential: "secret-live",
  presenceSessionId: "presence-restart",
};

async function fixture() {
  const now = Date.now(), claimant = "runtime-host:device-live:presence-original";
  const rows: Rows = {
    accountDeletionTombstones: [],
    chats: [{ _id: "chat-live", userId: "user-live", title: "Live cancellation" }],
    messages: [{
      _id: "message-live", userId: "user-live", chatId: "chat-live",
      role: "assistant", content: "Partial answer", status: "cancelled", createdAt: now,
    }],
    generationJobs: [{
      _id: "job-live", userId: "user-live", chatId: "chat-live",
      messageId: "message-live", status: "cancelled",
      runtimeCommandRecordId: "primary-record",
      executionRunId: "run-live", executionAttemptId: "attempt-live", executionFence: 19,
      completedAt: now, createdAt: now - 1_000,
    }],
    executionRuns: [{
      _id: "run-live", userId: "user-live", chatId: "chat-live",
      generationJobId: "job-live", kind: "chat_generation", state: "cancelled",
      terminalOutcome: "cancelled", activeAttemptId: "attempt-live",
      requestedPlacement: "local", nextAttemptNumber: 2, nextFence: 20,
      nextEventSequence: 3, completedAt: now, createdAt: now - 1_000, updatedAt: now,
    }],
    executionAttempts: [{
      _id: "attempt-live", runId: "run-live", userId: "user-live",
      attemptNumber: 1, executorKind: "local_runtime", placement: "local",
      adapterId: "codex", deviceId: "device-live", protocolVersion: "nanthai.runtime.v1",
      status: "cancelled", claimantId: claimant, fence: 19,
      runtimeLastWorkerSequence: 208,
      runtimeLastWorkerEventId: "turn-jn72-live:worker:208",
      completedAt: now, createdAt: now - 1_000, updatedAt: now,
    }],
    runtimeCommands: [
      {
        _id: "primary-record", runId: "run-live", attemptId: "attempt-live",
        userId: "user-live", commandId: "turn-jn72-live", expectedFence: 19,
        type: "start", status: "rejected", authorizationSource: "explicit_user_turn",
        initiatedBy: "user-live", inputHash: "primary-hash", targetDeviceId: "device-live",
        claimedBy: claimant, rejectionReason: "Execution cancelled",
        createdAt: now - 1_000, updatedAt: now,
      },
      {
        _id: "cancel-record", runId: "run-live", attemptId: "attempt-live",
        userId: "user-live", commandId: "cancel-job-live-19", expectedFence: 19,
        type: "cancel", status: "rejected", authorizationSource: "runtime_policy",
        initiatedBy: "user-live", inputHash: "cancel-hash", targetDeviceId: "device-live",
        claimedBy: claimant, rejectionReason: "Execution cancelled",
        createdAt: now - 500, updatedAt: now,
      },
    ],
    runtimeDevices: [{
      _id: "device-row-live", userId: "user-live", deviceId: "device-live",
      status: "active", currentCredentialId: "credential-live",
      currentPresenceId: "presence-row-restart", createdAt: now - 1_000, updatedAt: now,
    }],
    runtimeDeviceCredentials: [{
      _id: "credential-row-live", userId: "user-live",
      runtimeDeviceId: "device-row-live", deviceId: "device-live",
      credentialId: "credential-live", credentialHash: await sha256Hex("secret-live"),
      status: "active", issuedAt: now - 1_000,
    }],
    runtimeDevicePresences: [
      {
        _id: "presence-row-original", userId: "user-live",
        runtimeDeviceId: "device-row-live", deviceId: "device-live",
        credentialId: "credential-live", presenceSessionId: "presence-original",
        status: "superseded", expiresAt: now - 1,
      },
      {
        _id: "presence-row-restart", userId: "user-live",
        runtimeDeviceId: "device-row-live", deviceId: "device-live",
        credentialId: "credential-live", presenceSessionId: "presence-restart",
        status: "online", expiresAt: now + 60_000,
      },
    ],
    runEvents: [],
  };
  return {
    rows,
    ctx: createStatefulMockCtx(rows) as unknown as MutationCtx,
    now,
  };
}

async function cancellingFixture() {
  const state = await fixture();
  const run = state.rows.executionRuns[0];
  run.state = "cancelling";
  delete run.terminalOutcome;
  delete run.completedAt;
  const attempt = state.rows.executionAttempts[0];
  attempt.status = "running";
  attempt.leaseExpiresAt = state.now - 1;
  delete attempt.completedAt;
  return state;
}

function lateTerminal(outcome: "completed" | "failed" | "cancelled" | "interrupted") {
  return {
    eventId: "turn-jn72-live:worker:209",
    commandRecordId: "primary-record" as Id<"runtimeCommands">,
    commandId: "turn-jn72-live",
    runId: "run-live" as Id<"executionRuns">,
    attemptId: "attempt-live" as Id<"executionAttempts">,
    fence: 19,
    kind: "worker_message" as const,
    emittedAtMs: 1_786_752_000_209,
    payload: {
      wireVersion: "nanthai.runtime.process.v1", messageId: "worker-209",
      sequence: 209, sentAt: 1_786_752_000_209, kind: "terminal_event",
      payload: {
        sessionId: "attempt-live",
        event: {
          protocolVersion: "nanthai.runtime.v1", eventId: "adapter-terminal-209",
          sequence: 209, occurredAt: 1_786_752_000_209,
          runId: "run-live", attemptId: "attempt-live", fence: 19,
          sessionId: "attempt-live", type: "terminal", outcome,
          summary: "Cancellation settled", errorCode: null, checkpointRef: null,
        },
      },
    },
  };
}

function hostFailure(commandRecordId: string, commandId: string) {
  return {
    eventId: `${commandId}:host-failure`,
    commandRecordId: commandRecordId as Id<"runtimeCommands">,
    commandId,
    runId: "run-live" as Id<"executionRuns">,
    attemptId: "attempt-live" as Id<"executionAttempts">,
    fence: 19,
    kind: "host_command_failed" as const,
    emittedAtMs: 1_786_752_000_210,
    payload: { message: "Previous presence could not publish its final event" },
  };
}

function canonicalState(rows: Rows) {
  return {
    message: { ...rows.messages[0] },
    job: { ...rows.generationJobs[0] },
    run: { ...rows.executionRuns[0] },
    commands: rows.runtimeCommands.map((command) => ({ ...command })),
    runEvents: rows.runEvents.map((event) => ({ ...event })),
  };
}

test("restart drains a late cancelled terminal and both resulting host failures ACK-only", async () => {
  const { ctx, rows } = await fixture();
  const before = canonicalState(rows);
  const terminal = lateTerminal("cancelled");
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: terminal,
  }), true);
  assert.equal(rows.executionAttempts[0].runtimeLastWorkerSequence, 209);
  assert.equal(rows.executionAttempts[0].runtimeLastWorkerEventId, terminal.eventId);
  assert.deepEqual(canonicalState(rows), before);
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: terminal,
  }), true);
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: lateTerminal("completed"),
  }), /RUNTIME_EVENT_AFTER_TERMINAL/);
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: hostFailure("cancel-record", "cancel-job-live-19"),
  }), true);
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: hostFailure("primary-record", "turn-jn72-live"),
  }), true);
  assert.deepEqual(canonicalState(rows), before);
});

test("settled cancellation accepts interrupted but rejects non-cancellation terminal outcomes", async () => {
  const interrupted = await fixture();
  assert.equal(await ingestRuntimeEventHandler(interrupted.ctx, {
    ...restartedHost, event: lateTerminal("interrupted"),
  }), true);
  const completed = await fixture();
  await assert.rejects(ingestRuntimeEventHandler(completed.ctx, {
    ...restartedHost, event: lateTerminal("completed"),
  }), /RUNTIME_EVENT_AFTER_TERMINAL/);
  assert.equal(completed.rows.executionAttempts[0].runtimeLastWorkerSequence, 208);
});

test("restarted host canonically settles an in-progress cancellation from its original claim", async () => {
  const state = await cancellingFixture();
  const terminal = lateTerminal("cancelled");
  assert.equal(await ingestRuntimeEventHandler(state.ctx, {
    ...restartedHost, event: terminal,
  }), true);
  assert.equal(state.rows.executionRuns[0].state, "cancelled");
  assert.equal(state.rows.executionRuns[0].terminalOutcome, "cancelled");
  assert.equal(state.rows.executionAttempts[0].status, "cancelled");
  assert.equal(state.rows.executionAttempts[0].runtimeLastWorkerSequence, 209);
  assert.equal(state.rows.executionAttempts[0].runtimeLastWorkerEventId, terminal.eventId);
  assert.equal(state.rows.generationJobs[0].status, "cancelled");
  assert.equal(state.rows.messages[0].status, "cancelled");
  assert.deepEqual(
    state.rows.runtimeCommands.map((command) => command.status),
    ["rejected", "rejected"],
  );
  assert.equal(await ingestRuntimeEventHandler(state.ctx, {
    ...restartedHost, event: hostFailure("cancel-record", "cancel-job-live-19"),
  }), true);
  assert.equal(await ingestRuntimeEventHandler(state.ctx, {
    ...restartedHost, event: hostFailure("primary-record", "turn-jn72-live"),
  }), true);
});

test("restart recovery does not accept a non-cancellation terminal", async () => {
  const state = await cancellingFixture();
  await assert.rejects(ingestRuntimeEventHandler(state.ctx, {
    ...restartedHost, event: lateTerminal("completed"),
  }), /EXECUTION_CLAIMANT_MISMATCH/);
  assert.equal(state.rows.executionRuns[0].state, "cancelling");
  assert.equal(state.rows.executionAttempts[0].runtimeLastWorkerSequence, 208);
});

test("buffered host failure settles an unfinished cancellation without reopening output", async () => {
  const { ctx, rows } = await cancellingFixture();
  const content = rows.messages[0].content;
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: hostFailure("primary-record", "turn-jn72-live"),
  }), true);
  assert.equal(rows.executionRuns[0].state, "cancelled");
  assert.equal(rows.executionAttempts[0].status, "cancelled");
  assert.equal(rows.messages[0].status, "cancelled");
  assert.equal(rows.messages[0].content, content);
});

test("scheduled permission failure drains cancellation without replacing its timeout result", async () => {
  const { ctx, rows } = await cancellingFixture();
  rows.generationJobs[0].status = "failed";
  rows.messages[0].status = "failed";
  rows.messages[0].content = "Scheduled permission timed out";
  const before = { ...rows.messages[0] };
  const terminal = lateTerminal("cancelled");
  const usage = {
    ...terminal,
    payload: { ...terminal.payload, kind: "adapter_event", payload: {
      sessionId: "attempt-live", event: {
        protocolVersion: "nanthai.runtime.v1", eventId: "late-usage", sequence: 209,
        occurredAt: Date.now(), runId: "run-live", attemptId: "attempt-live", fence: 19,
        sessionId: "attempt-live", type: "usage_reported", actualModel: null,
        tokens: { input: 10, output: 0, cachedInput: null, reasoning: null, total: 10 },
        cost: { source: "unpriced", reason: "Native cleanup usage" },
      },
    } },
  };
  assert.equal(await ingestRuntimeEventHandler(ctx, { ...restartedHost, event: usage }), true);
  assert.equal(rows.generationJobs[0].runtimeUsage, undefined);
  terminal.eventId = "turn-jn72-live:worker:210";
  terminal.payload.sequence = 210;
  terminal.payload.payload.event.sequence = 210;
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: terminal,
  }), true);
  assert.equal(rows.executionRuns[0].state, "cancelled");
  assert.equal(rows.executionAttempts[0].status, "cancelled");
  assert.equal(rows.generationJobs[0].status, "failed");
  assert.deepEqual(rows.messages[0], before);
  assert.equal(await ingestRuntimeEventHandler(ctx, { ...restartedHost, event: terminal }), true);
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: lateTerminal("completed"),
  }), /RUNTIME_EVENT_AFTER_TERMINAL/);
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: hostFailure("primary-record", "turn-jn72-live"),
  }), true);
});

test("buffered host failure completes a timeout's owned cancellation", async () => {
  const { ctx, rows } = await cancellingFixture();
  rows.generationJobs[0].status = "failed";
  rows.messages[0].status = "failed";
  const before = { ...rows.messages[0] };
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: hostFailure("cancel-record", "cancel-job-live-19"),
  }), true);
  assert.equal(rows.executionRuns[0].state, "cancelled");
  assert.equal(rows.executionAttempts[0].status, "cancelled");
  assert.deepEqual(rows.messages[0], before);
});
