import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { sha256Hex } from "../runtime_host/security";

import {
  fixture, oldHost, restartedHost, workerEvent, hostFailure, restart, canonicalState,
} from "./runtime_host_event_replay_fixture";

test("a restarted host drains the final result and failure after terminalization", async () => {
  const { ctx, rows, now } = await fixture();
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...oldHost, event: workerEvent(5, "terminal_event"),
  }), true);
  assert.equal(rows.messages[0].status, "completed");
  assert.equal(rows.messages[0].content, "Canonical answer");
  assert.equal(rows.generationJobs[0].status, "completed");
  assert.equal(rows.executionAttempts[0].status, "completed");
  assert.equal(rows.runtimeCommands[0].status, "completed");

  const terminalState = canonicalState(rows);
  restart(rows, now);
  const finalResult = workerEvent(6, "command_result");
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: finalResult,
  }), true);
  assert.equal(rows.executionAttempts[0].runtimeLastWorkerSequence, 6);
  assert.equal(rows.executionAttempts[0].runtimeLastWorkerEventId, finalResult.eventId);
  assert.deepEqual(canonicalState(rows), terminalState);

  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: finalResult,
  }), true);
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: hostFailure(),
  }), true);
  assert.deepEqual(canonicalState(rows), terminalState);

  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: workerEvent(8, "command_result"),
  }), /RUNTIME_WORKER_SEQUENCE_GAP/);
  const notFinal = workerEvent(7, "command_result");
  (notFinal.payload.payload as { status: string }).status = "accepted";
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: notFinal,
  }), /RUNTIME_EVENT_AFTER_TERMINAL/);
  assert.equal(rows.executionAttempts[0].runtimeLastWorkerSequence, 6);
});

test("a cancelled job still accepts the host terminal event while its run is cancelling", async () => {
  const { ctx, rows } = await fixture();
  rows.generationJobs[0].status = "cancelled";
  rows.executionRuns[0].state = "cancelling";
  assert.equal(await ingestRuntimeEventHandler(ctx, {
    ...oldHost, event: workerEvent(5, "terminal_event"),
  }), true);
  assert.equal(rows.messages[0].status, "cancelled");
  assert.equal(rows.generationJobs[0].status, "cancelled");
  assert.equal(rows.executionRuns[0].state, "cancelled");
  assert.equal(rows.executionAttempts[0].status, "cancelled");
  assert.equal(rows.executionAttempts[0].runtimeLastWorkerSequence, 5);
});

test("post-terminal replay rejects forged device, credential, and correlations", async () => {
  const { ctx, rows, now } = await fixture();
  await ingestRuntimeEventHandler(ctx, { ...oldHost, event: workerEvent(5, "terminal_event") });
  restart(rows, now);

  rows.runtimeDevices.push({
    _id: "device-row-2", userId: "user-1", deviceId: "device-2",
    status: "active", currentCredentialId: "credential-2",
  });
  rows.runtimeDeviceCredentials.push({
    _id: "credential-row-2", userId: "user-1", runtimeDeviceId: "device-row-2",
    deviceId: "device-2", credentialId: "credential-2", status: "active",
    credentialHash: await sha256Hex("secret-2"), issuedAt: now,
  });
  rows.runtimeDevicePresences.push({
    _id: "presence-row-2", runtimeDeviceId: "device-row-2", deviceId: "device-2",
    credentialId: "credential-2", presenceSessionId: "presence-2",
    status: "online", expiresAt: now + 60_000,
  });
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    deviceId: "device-2", credentialId: "credential-2", credential: "secret-2",
    presenceSessionId: "presence-2", event: workerEvent(6, "command_result"),
  }), /RUNTIME_ROUTE_MISMATCH/);

  rows.runtimeDeviceCredentials.push({
    _id: "credential-row-other", userId: "user-1", runtimeDeviceId: "device-row-1",
    deviceId: "device-1", credentialId: "credential-other", status: "active",
    credentialHash: await sha256Hex("secret-other"), issuedAt: now,
  });
  rows.runtimeDevicePresences.push({
    _id: "presence-row-other", runtimeDeviceId: "device-row-1", deviceId: "device-1",
    credentialId: "credential-other", presenceSessionId: "presence-other",
    status: "online", expiresAt: now + 60_000,
  });
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    deviceId: "device-1", credentialId: "credential-other", credential: "secret-other",
    presenceSessionId: "presence-other", event: workerEvent(6, "command_result"),
  }), /RUNTIME_EVENT_CREDENTIAL_MISMATCH/);

  const forgedInner = workerEvent(5, "terminal_event");
  const terminal = forgedInner.payload.payload as { event: { fence: number } };
  terminal.event.fence = 8;
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: forgedInner,
  }), /RUNTIME_ADAPTER_EVENT_IDENTITY_MISMATCH/);
  rows.runtimeCommands.push({
    ...rows.runtimeCommands[0], _id: "cancel-record", commandId: "cancel-command",
    type: "cancel", status: "acknowledged",
  });
  const followupTerminal = workerEvent(6, "terminal_event");
  followupTerminal.commandRecordId = "cancel-record" as Id<"runtimeCommands">;
  followupTerminal.commandId = "cancel-command";
  followupTerminal.eventId = "cancel-command:worker:6";
  await assert.rejects(ingestRuntimeEventHandler(ctx, {
    ...restartedHost, event: followupTerminal,
  }), /RUNTIME_EVENT_COMMAND_MISMATCH/);

  const valid = workerEvent(6, "command_result");
  const forged = [
    { ...valid, commandRecordId: "wrong-command" as Id<"runtimeCommands"> },
    { ...valid, runId: "wrong-run" as Id<"executionRuns"> },
    { ...valid, attemptId: "wrong-attempt" as Id<"executionAttempts"> },
    { ...valid, fence: 8 },
    { ...valid, commandId: "wrong-command-id" },
  ];
  for (const event of forged) {
    await assert.rejects(ingestRuntimeEventHandler(ctx, { ...restartedHost, event }));
  }
});
