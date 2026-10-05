import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import {
  claimRuntimeHostCommandHandler,
  completeRuntimeHostCommandHandler,
} from "../runtime_host/host_commands";
import { expireRuntimePermissionHandler } from "../runtime_host/permission_expiry";
import {
  listMyPendingPermissionsHandler,
  respondToPermissionHandler,
} from "../runtime_host/permissions";
import {
  commandResultEvent,
  createPermissionFixture,
  permissionHost,
  permissionRequestedEvent,
  permissionResolvedEvent,
} from "./runtime_host_permission_fixture";

type Row = Record<string, unknown>;
const decisions = ["allow_once", "allow_session", "deny", "cancel"] as const;

test("permission ingestion persists exact bounded state while its worker attempt stays live", async () => {
  const state = await createPermissionFixture();
  const requestEvent = permissionRequestedEvent(0, state.now);
  assert.equal(await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost, event: requestEvent,
  }), true);
  assert.equal(state.rows.runtimePermissionRequests.length, 1);
  assert.deepEqual(pick(state.rows.runtimePermissionRequests[0], [
    "runId", "attemptId", "fence", "permissionRequestId", "toolCallId",
    "permissionKind", "prompt", "choices", "status",
  ]), {
    runId: "run-1",
    attemptId: "attempt-1",
    fence: 7,
    permissionRequestId: "native-request-1",
    toolCallId: "tool-1",
    permissionKind: "command_execution",
    prompt: "Allow Codex to run the test command?",
    choices: decisions,
    status: "pending",
  });
  assert.equal(state.rows.executionRuns[0].state, "waiting_for_permission");
  assert.equal(state.rows.executionAttempts[0].status, "running");
  assert.equal(state.rows.executionAttempts[0].claimantId,
    "runtime-host:device-1:presence-1");
  assert.ok(Number(state.rows.executionAttempts[0].leaseExpiresAt) > state.now);

  const pending = await listMyPendingPermissionsHandler(
    state.ctx as unknown as QueryCtx,
    { userId: "user_1", chatId: "chat-1" as Id<"chats">, now: state.now + 10 },
  );
  assert.equal(pending.length, 1);
  assert.equal(pending[0].messageId, "message-1");
  assert.equal(pending[0].chatParticipantId, "participant-1");
  assert.equal(pending[0].canRespond, true);

  assert.equal(await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost, event: requestEvent,
  }), true);
  assert.equal(state.rows.runtimePermissionRequests.length, 1);
  await assert.rejects(ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionRequestedEvent(1, state.now, {
      eventId: "another-request-event",
      permissionRequestId: "native-request-1",
    }),
  }), /reused an active permission request ID/i);
});

test("all permission decisions use one idempotent fenced follow-up and resume after resolution", async () => {
  for (const decision of decisions) {
    const state = await createPermissionFixture();
    await ingestRuntimeEventHandler(state.ctx, {
      ...permissionHost, event: permissionRequestedEvent(0, state.now),
    });
    const requestId = state.rows.runtimePermissionRequests[0]
      ._id as Id<"runtimePermissionRequests">;
    const response = await respondToPermissionHandler(state.ctx, {
      userId: "user_1", requestId, decision, now: state.now + 10,
    });
    const responseCommand = rowById(state.rows.runtimeCommands, response.commandRecordId);
    assert.equal(responseCommand.type, "permission_response");
    assert.equal(responseCommand.authorizationSource, "interactive_confirmation");
    assert.equal(responseCommand.targetDeviceId, "device-1");
    assert.deepEqual(JSON.parse(String(responseCommand.payload)), {
      permissionRequestId: "native-request-1", decision,
    });
    assert.equal(state.rows.executionRuns[0].state, "waiting_for_permission");
    assert.equal(state.rows.executionAttempts[0].status, "running");
    assert.deepEqual(await respondToPermissionHandler(state.ctx, {
      userId: "user_1", requestId, decision, now: state.now + 11,
    }), response);
    const another = decision === "deny" ? "allow_once" : "deny";
    await assert.rejects(respondToPermissionHandler(state.ctx, {
      userId: "user_1", requestId, decision: another, now: state.now + 11,
    }), /different permission decision/i);

    assert.equal((await claimRuntimeHostCommandHandler(state.ctx, {
      ...permissionHost, commandRecordId: response.commandRecordId,
    })).claimed, true);
    await ingestRuntimeEventHandler(state.ctx, {
      ...permissionHost,
      event: permissionResolvedEvent(
        1,
        state.now,
        decision,
        "native-request-1",
        {
          commandRecordId: response.commandRecordId,
          commandId: String(responseCommand.commandId),
        },
      ),
    });
    assert.equal(state.rows.runtimePermissionRequests[0].status, "resolved");
    assert.equal(state.rows.runtimePermissionRequests[0].resolvedDecision, decision);
    assert.equal(state.rows.executionRuns[0].state, "running");
    assert.equal(state.rows.executionAttempts[0].status, "running");

    await ingestRuntimeEventHandler(state.ctx, {
      ...permissionHost,
      event: commandResultEvent(
        2,
        state.now,
        response.commandRecordId,
        String(responseCommand.commandId),
      ),
    });
    assert.equal(await completeRuntimeHostCommandHandler(state.ctx, {
      ...permissionHost, commandRecordId: response.commandRecordId, status: "completed",
    }), true);
    assert.equal(state.rows.executionRuns[0].state, "running");
  }
});

test("permission resolution is bound to its exact non-primary response command", async () => {
  const state = await createPermissionFixture();
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost, event: permissionRequestedEvent(0, state.now),
  });
  const requestId = state.rows.runtimePermissionRequests[0]
    ._id as Id<"runtimePermissionRequests">;
  const response = await respondToPermissionHandler(state.ctx, {
    userId: "user_1", requestId, decision: "allow_once", now: state.now + 10,
  });
  assert.equal((await claimRuntimeHostCommandHandler(state.ctx, {
    ...permissionHost, commandRecordId: response.commandRecordId,
  })).claimed, true);
  const responseCommand = rowById(state.rows.runtimeCommands, response.commandRecordId);
  const forgedCommandId = "permission-response-forged";
  state.rows.runtimeCommands.push({
    ...structuredClone(responseCommand),
    _id: "permission-response-forged-record",
    commandId: forgedCommandId,
  });

  await assert.rejects(ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionResolvedEvent(
      1,
      state.now,
      "allow_once",
      "native-request-1",
      {
        commandRecordId: "permission-response-forged-record" as Id<"runtimeCommands">,
        commandId: forgedCommandId,
      },
    ),
  }), /does not match its response command/i);

  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionResolvedEvent(
      1,
      state.now,
      "allow_once",
      "native-request-1",
      {
        commandRecordId: response.commandRecordId,
        commandId: String(responseCommand.commandId),
      },
    ),
  });
  assert.equal(state.rows.runtimePermissionRequests[0].status, "resolved");
  assert.equal(state.rows.generationJobs[0].runtimeCommandRecordId, "command-1");
});

test("respond revalidates owner, current host, adapter capability, and active native session", async () => {
  const state = await createPermissionFixture();
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost, event: permissionRequestedEvent(0, state.now),
  });
  const requestId = state.rows.runtimePermissionRequests[0]
    ._id as Id<"runtimePermissionRequests">;
  await assert.rejects(respondToPermissionHandler(state.ctx, {
    userId: "another-user", requestId, decision: "allow_once", now: state.now + 10,
  }), /not found/i);

  const presence = state.rows.runtimeDevicePresences[0];
  const adapters = presence.adapters as Array<Row>;
  const capabilities = adapters[0].capabilities as Row;
  const operations = capabilities.operations as Row;
  operations.permissionResponse = false;
  const unavailable = await listMyPendingPermissionsHandler(
    state.ctx as unknown as QueryCtx,
    { userId: "user_1", chatId: "chat-1" as Id<"chats">, now: state.now + 10 },
  );
  assert.equal(unavailable[0].canRespond, false);
  assert.equal(unavailable[0].unavailableReason, "runtime_adapter_unavailable");
  await assert.rejects(respondToPermissionHandler(state.ctx, {
    userId: "user_1", requestId, decision: "allow_once", now: state.now + 10,
  }), /cannot answer permission requests/i);

  operations.permissionResponse = true;
  presence.status = "superseded";
  state.rows.runtimeDevicePresences.push({
    ...structuredClone(presence),
    _id: "presence-row-2",
    presenceSessionId: "presence-2",
    status: "online",
  });
  state.rows.runtimeDevices[0].currentPresenceId = "presence-row-2";
  await assert.rejects(respondToPermissionHandler(state.ctx, {
    userId: "user_1", requestId, decision: "allow_once", now: state.now + 10,
  }), /session.*no longer active/i);

  presence.status = "online";
  state.rows.runtimeDevices[0].currentPresenceId = "presence-row-1";
  state.rows.runtimeSessionBindings[0].status = "released";
  await assert.rejects(respondToPermissionHandler(state.ctx, {
    userId: "user_1", requestId, decision: "allow_once", now: state.now + 10,
  }), /session.*no longer active/i);
  assert.equal(state.rows.runtimeCommands.length, 1);
});

test("native expiry removes the choice without inventing denial or releasing the worker", async () => {
  const state = await createPermissionFixture();
  const expiresAt = state.now + 100;
  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost,
    event: permissionRequestedEvent(0, state.now, { expiresAt }),
  });
  const requestId = state.rows.runtimePermissionRequests[0]
    ._id as Id<"runtimePermissionRequests">;
  assert.equal(state.state.scheduled.length, 1);
  assert.equal(await expireRuntimePermissionHandler(state.ctx, {
    requestId, expectedExpiresAt: expiresAt, now: expiresAt,
  }), true);
  assert.equal(state.rows.runtimePermissionRequests[0].status, "expired");
  assert.equal(state.rows.executionRuns[0].state, "waiting_for_permission");
  assert.equal(state.rows.executionAttempts[0].status, "running");
  assert.equal(state.rows.runtimeCommands.length, 1);
  await assert.rejects(respondToPermissionHandler(state.ctx, {
    userId: "user_1", requestId, decision: "deny", now: expiresAt,
  }), /expired/i);

  await ingestRuntimeEventHandler(state.ctx, {
    ...permissionHost, event: permissionResolvedEvent(1, expiresAt, "deny"),
  });
  assert.equal(state.rows.runtimePermissionRequests[0].status, "resolved");
  assert.equal(state.rows.executionRuns[0].state, "running");
});

function rowById(rows: Row[], id: string): Row {
  const row = rows.find((candidate) => candidate._id === id);
  assert.ok(row);
  return row;
}

function pick(row: Row, keys: string[]): Row {
  return Object.fromEntries(keys.map((key) => [key, row[key]]));
}

test("a pending cancellation for an already settled attempt expires without blocking host polling", async () => {
  const state = await createPermissionFixture();
  state.rows.executionRuns[0].state = "cancelled";
  state.rows.executionAttempts[0].status = "cancelled";
  const command = state.rows.runtimeCommands[0];
  command.type = "cancel";
  command.status = "pending";
  const result = await claimRuntimeHostCommandHandler(state.ctx, { ...permissionHost, commandRecordId: "command-1" as Id<"runtimeCommands"> });
  assert.equal(result.claimed, false);
  assert.equal(command.status, "expired");
});
