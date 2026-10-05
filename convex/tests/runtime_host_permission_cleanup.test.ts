import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import { deleteChatExecutionBatch } from "../execution/chat_cleanup";
import { requestRunTreeTeardown } from "../execution/teardown_graph";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { terminalizeRuntimeChatTurn } from "../runtime_host/chat_terminal_ingestion";
import {
  createPermissionFixture,
  permissionHost,
  permissionRequestedEvent,
  permissionResolvedEvent,
} from "./runtime_host_permission_fixture";

test("a run remains permission-waiting until every outstanding request resolves", async () => {
  const state = await createPermissionFixture();
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionRequestedEvent(0, state.now, { permissionRequestId: "request-1" }),
  });
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionRequestedEvent(1, state.now, { permissionRequestId: "request-2" }),
  });
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionResolvedEvent(2, state.now, "allow_once", "request-1"),
  });
  assert.equal(state.rows.executionRuns[0].state, "waiting_for_permission");
  assert.deepEqual(
    state.rows.runtimePermissionRequests.map((request) => request.status),
    ["resolved", "pending"],
  );
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionResolvedEvent(3, state.now, "deny", "request-2"),
  });
  assert.equal(state.rows.executionRuns[0].state, "running");
  assert.ok(state.rows.runtimePermissionRequests.every(
    (request) => request.status === "resolved",
  ));
});

test("canonical terminalization closes an unanswered permission before settling the run", async () => {
  const state = await createPermissionFixture();
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost, event: permissionRequestedEvent(0, state.now),
  });
  await terminalizeRuntimeChatTurn(state.ctx, {
    host: {
      credential: state.rows.runtimeDeviceCredentials[0] as Doc<"runtimeDeviceCredentials">,
      device: state.rows.runtimeDevices[0] as Doc<"runtimeDevices">,
      claimantId: "runtime-host:device-1:presence-1",
    },
    run: state.rows.executionRuns[0] as Doc<"executionRuns">,
    attempt: state.rows.executionAttempts[0] as Doc<"executionAttempts">,
    job: state.rows.generationJobs[0] as Doc<"generationJobs">,
    command: state.rows.runtimeCommands[0] as Doc<"runtimeCommands">,
  }, {
    protocolVersion: "nanthai.runtime.v1",
    eventId: "terminal-1",
    sequence: 1,
    occurredAt: state.now + 10,
    runId: "run-1",
    attemptId: "attempt-1",
    fence: 7,
    sessionId: "attempt-1",
    type: "terminal",
    outcome: "completed",
    summary: "Turn completed",
    errorCode: null,
    checkpointRef: null,
  });
  assert.equal(state.rows.runtimePermissionRequests[0].status, "closed");
  assert.equal(state.rows.runtimePermissionRequests[0].closedReason, "runtime_completed");
  assert.equal(state.rows.executionRuns[0].state, "completed");
  assert.equal(state.rows.executionAttempts[0].status, "completed");
});

test("central Stop teardown closes permission state and chat deletion removes its rows", async () => {
  const stopped = await createPermissionFixture();
  await ingestRuntimeEventHandler(stopped.ctx, {
    ...permissionHost, event: permissionRequestedEvent(0, stopped.now),
  });
  for (let pass = 0; pass < 3; pass += 1) {
    await requestRunTreeTeardown(
      stopped.ctx,
      "run-1" as Id<"executionRuns">,
      "user_1",
      "Cancelled by user",
    );
  }
  assert.equal(stopped.rows.runtimePermissionRequests[0].status, "closed");
  assert.equal(stopped.rows.runtimeCommands[0].status, "acknowledged");
  const cancel = stopped.rows.runtimeCommands.find(command => command.type === "cancel");
  assert.equal(cancel?.status, "pending");
  assert.ok(cancel);
  cancel.expiresAt = Date.now() - 1;
  await requestRunTreeTeardown(stopped.ctx, "run-1" as Id<"executionRuns">,
    "user_1", "Cancelled by user");
  assert.ok(stopped.rows.runtimeCommands.every(command => command.status === "rejected"));

  const deleted = await createPermissionFixture();
  await ingestRuntimeEventHandler(deleted.ctx, {
    ...permissionHost, event: permissionRequestedEvent(0, deleted.now),
  });
  assert.equal(await deleteChatExecutionBatch(
    deleted.ctx,
    "chat-1" as Id<"chats">,
    40,
  ), false);
  assert.deepEqual(deleted.rows.runtimePermissionRequests, []);
  assert.deepEqual(deleted.rows.executionRuns, []);
});
