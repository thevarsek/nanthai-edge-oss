import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";
import { createExecutionRun } from "../execution/runs";
import { requestRunTreeTeardown } from "../execution/teardown_graph";
import { ingestRuntimeEvent } from "../runtime_host/chat_event_ingestion";
import { enqueueRuntimeHostCommand } from "../runtime_host/command_transport";
import {
  claimRuntimeHostCommandHandler,
  completeRuntimeHostCommandHandler,
} from "../runtime_host/host_commands";
import { sha256Hex } from "../runtime_host/security";
import { registerRuntimeTurnPacket } from "../runtime_host/turn_packets";

type Rows = Record<string, Array<Record<string, unknown>>>;
type RuntimeEventArgs = {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
  event: {
    eventId: string;
    commandRecordId: Id<"runtimeCommands">;
    commandId: string;
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    kind: "worker_message";
    emittedAtMs: number;
    payload: unknown;
  };
};
type EventMutation = {
  _handler: (ctx: MutationCtx, args: RuntimeEventArgs) => Promise<boolean>;
};

const host = {
  deviceId: "device-1",
  credentialId: "credential-1",
  credential: "secret-1",
  presenceSessionId: "presence-session-1",
};

async function fixture() {
  const now = Date.now();
  const rows: Rows = {
    chats: [{ _id: "chat_1", userId: "user_1", title: "Runtime", mode: "single" }],
    messages: [{
      _id: "message_1", userId: "user_1", chatId: "chat_1", role: "assistant",
      content: "partial", status: "streaming", createdAt: now,
    }],
    generationJobs: [{
      _id: "job_1", userId: "user_1", chatId: "chat_1", messageId: "message_1",
      status: "streaming", createdAt: now,
    }],
    runtimeDevices: [{
      _id: "device_row_1", userId: "user_1", deviceId: "device-1",
      displayName: "Mac", status: "active", currentCredentialId: "credential-1",
    }],
    runtimeDeviceCredentials: [{
      _id: "credential_row_1", userId: "user_1", runtimeDeviceId: "device_row_1",
      deviceId: "device-1", credentialId: "credential-1",
      credentialHash: await sha256Hex("secret-1"), status: "active", issuedAt: now,
    }],
    runtimeDevicePresences: [{
      _id: "presence_1", userId: "user_1", runtimeDeviceId: "device_row_1",
      deviceId: "device-1", presenceSessionId: "presence-session-1",
      credentialId: "credential-1", status: "online", expiresAt: now + 1_000_000,
    }],
    accountDeletionTombstones: [], executionRuns: [], executionAttempts: [],
    runEvents: [], runtimeCommands: [], runtimeTurnPackets: [],
    executionComponentRefs: [], runtimeSessionBindings: [],
    runtimeConversationBindings: [], executionTeardownTasks: [],
    executionOperations: [], generationContinuations: [], streamingMessages: [{
      _id: "stream_1", messageId: "message_1", chatId: "chat_1", userId: "user_1",
      content: "partial", status: "streaming", createdAt: now, updatedAt: now,
    }],
    analyticsWorkflowRuns: [], analyticsArtifactIntents: [], toolExecutionArtifacts: [],
    advisorBatches: [], advisorRuns: [], videoJobs: [], videoOutputUploads: [],
    usageRecords: [],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const execution = await createExecutionRun(ctx, {
    userId: "user_1", runKey: "local-turn", kind: "chat_generation",
    requestedPlacement: "local", chatId: "chat_1" as Id<"chats">,
    generationJobId: "job_1" as Id<"generationJobs">,
    initialAttempt: {
      executorKind: "local_runtime", placement: "local", adapterId: "codex",
      deviceId: "device-1", orchestrationEngine: "runtime_adapter",
    },
    now,
  });
  const packetId = await registerRuntimeTurnPacket(ctx, {
    ...execution, userId: "user_1", commandId: "turn-job_1-1",
    packetHash: "a".repeat(64), storageId: "storage_1" as Id<"_storage">,
    byteLength: 128, expiresAt: now + 60_000, now,
  });
  const commandRecordId = await enqueueRuntimeHostCommand(ctx, {
    ...execution, targetDeviceId: "device-1", commandId: "turn-job_1-1",
    type: "start", authorizationSource: "explicit_user_turn", initiatedBy: "user_1",
    turnPacketId: packetId, expiresAt: now + 60_000, now,
  });
  await ctx.db.patch("job_1" as Id<"generationJobs">, {
    executionRunId: execution.runId, executionAttemptId: execution.attemptId,
    executionFence: execution.fence, runtimeCommandRecordId: commandRecordId,
    runtimeTurnPacketId: packetId,
  });
  return { rows, ctx, now, execution, commandRecordId };
}

test("Stop fences an active local turn, delivers one cancel, and accepts only its terminal drain", async () => {
  const state = await fixture();
  await claimRuntimeHostCommandHandler(state.ctx, {
    ...host, commandRecordId: state.commandRecordId,
  });
  await state.ctx.db.insert("runtimeSessionBindings", {
    runId: state.execution.runId,
    attemptId: state.execution.attemptId,
    userId: "user_1",
    adapterId: "codex",
    bindingKey: "conversation:test",
    fence: state.execution.fence,
    status: "active",
    nativeSessionId: "native-session-1",
    deviceId: "device-1",
    boundAt: state.now,
  });
  assert.equal(await cancelExecutionForGenerationJob(state.ctx, {
    jobId: "job_1" as Id<"generationJobs">, requestedBy: "user_1", now: state.now + 10,
  }), true);
  assert.equal(state.rows.executionRuns[0].state, "cancelling");
  assert.equal(state.rows.runtimeCommands.length, 2);
  const cancelCommand = state.rows.runtimeCommands[1];
  assert.equal(cancelCommand.commandId, "cancel-job_1-1");
  assert.deepEqual(JSON.parse(String(cancelCommand.payload)), {
    cancellationId: "cancel-job_1-1", reason: "Cancelled by user_1",
  });

  await cancelExecutionForGenerationJob(state.ctx, {
    jobId: "job_1" as Id<"generationJobs">, requestedBy: "user_1", now: state.now + 11,
  });
  assert.equal(state.rows.runtimeCommands.length, 2);
  const cancelRecordId = cancelCommand._id as Id<"runtimeCommands">;
  const claimed = await claimRuntimeHostCommandHandler(state.ctx, {
    ...host, commandRecordId: cancelRecordId,
  });
  assert.equal(claimed.claimed, true);

  await state.ctx.db.patch("job_1" as Id<"generationJobs">, { status: "cancelled" });
  await state.ctx.db.patch("message_1" as Id<"messages">, { status: "cancelled" });
  const ingest = (ingestRuntimeEvent as unknown as EventMutation)._handler;
  await ingest(state.ctx, runtimeEvent(state, 0, "adapter_event", {
    sessionId: String(state.execution.attemptId),
    event: adapterEvent(state, 0, "text_delta", {
      messageId: "message_1", delta: " SHOULD_NOT_APPEAR",
    }),
  }));
  assert.equal(state.rows.streamingMessages[0].content, "partial");
  assert.equal(state.rows.executionAttempts[0].runtimeLastWorkerSequence, 0);

  const acceptedCancel = runtimeEvent(state, 1, "command_result", {
    requestMessageId: "cancel-request", status: "accepted", code: null,
    summary: "Cancellation accepted; awaiting terminal event",
  }, { commandRecordId: cancelRecordId, commandId: "cancel-job_1-1" });
  await ingest(state.ctx, acceptedCancel);

  await ingest(state.ctx, runtimeEvent(state, 2, "terminal_event", {
    sessionId: String(state.execution.attemptId),
    event: adapterEvent(state, 2, "terminal", {
      outcome: "cancelled", summary: "Cancelled by user", errorCode: null,
      checkpointRef: null,
    }),
  }));
  assert.equal(state.rows.executionRuns[0].state, "cancelled");
  assert.equal(state.rows.executionAttempts[0].status, "cancelled");
  assert.equal(state.rows.executionComponentRefs[0].status, "cancelled");
  assert.equal(state.rows.runtimeSessionBindings[0].status, "revoked");
  assert.equal(state.rows.messages[0].content, "partial");

  await ingest(state.ctx, acceptedCancel);
  await assert.rejects(() => ingest(state.ctx, runtimeEvent(state, 3, "command_result", {
    requestMessageId: "primary-request", status: "accepted", code: null,
    summary: "Turn accepted too late",
  })));
  await ingest(state.ctx, runtimeEvent(state, 3, "command_result", {
    requestMessageId: "primary-request", status: "completed", code: null,
    summary: "Turn drained",
  }));
  await ingest(state.ctx, runtimeEvent(state, 4, "command_result", {
    requestMessageId: "cancel-request", status: "completed", code: null,
    summary: "Cancellation drained",
  }, { commandRecordId: cancelRecordId, commandId: "cancel-job_1-1" }));
  assert.equal(await completeRuntimeHostCommandHandler(state.ctx, {
    ...host, commandRecordId: state.commandRecordId, status: "completed",
  }), false);
  assert.equal(await completeRuntimeHostCommandHandler(state.ctx, {
    ...host, commandRecordId: cancelRecordId, status: "completed",
  }), true);
  assert.ok(state.rows.runtimeCommands.every((command) => command.status === "completed"));
});

test("Stop rejects an unclaimed local turn and settles it without inventing a host ACK", async () => {
  const state = await fixture();
  await cancelExecutionForGenerationJob(state.ctx, {
    jobId: "job_1" as Id<"generationJobs">, requestedBy: "user_1", now: state.now + 10,
  });
  assert.equal(state.rows.runtimeCommands.length, 1);
  await requestRunTreeTeardown(
    state.ctx, state.execution.runId, "user_1", "Cancelled by user_1",
  );
  await requestRunTreeTeardown(
    state.ctx, state.execution.runId, "user_1", "Cancelled by user_1",
  );
  await requestRunTreeTeardown(
    state.ctx, state.execution.runId, "user_1", "Cancelled by user_1",
  );
  assert.equal(state.rows.runtimeCommands[0].status, "rejected");
  assert.equal(state.rows.executionRuns[0].state, "cancelled");
  assert.equal(state.rows.executionAttempts[0].status, "cancelled");
  assert.equal(state.rows.executionTeardownTasks[0].status, "settled");
});

test("an offline claimed worker remains truthfully cancelling after bounded command cleanup", async () => {
  const state = await fixture();
  await claimRuntimeHostCommandHandler(state.ctx, {
    ...host, commandRecordId: state.commandRecordId,
  });
  await cancelExecutionForGenerationJob(state.ctx, {
    jobId: "job_1" as Id<"generationJobs">, requestedBy: "user_1", now: state.now + 10,
  });
  await state.ctx.db.patch("presence_1" as Id<"runtimeDevicePresences">, {
    status: "offline",
  });
  await requestRunTreeTeardown(
    state.ctx, state.execution.runId, "user_1", "Cancelled by user_1",
  );
  await requestRunTreeTeardown(
    state.ctx, state.execution.runId, "user_1", "Cancelled by user_1",
  );
  assert.ok(state.rows.runtimeCommands.every((command) => command.status === "rejected"));
  assert.equal(state.rows.executionComponentRefs[0].status, "cancel_requested");
  assert.equal(state.rows.executionRuns[0].state, "cancelling");
  assert.equal(state.rows.executionAttempts[0].status, "running");
});

function runtimeEvent(
  state: Awaited<ReturnType<typeof fixture>>,
  sequence: number,
  kind: "adapter_event" | "terminal_event" | "command_result",
  payload: unknown,
  command = {
    commandRecordId: state.commandRecordId,
    commandId: "turn-job_1-1",
  },
): RuntimeEventArgs {
  return {
    ...host,
    event: {
      eventId: `${command.commandId}:worker:${sequence}`,
      commandRecordId: command.commandRecordId,
      commandId: command.commandId,
      runId: state.execution.runId,
      attemptId: state.execution.attemptId,
      fence: state.execution.fence,
      kind: "worker_message",
      emittedAtMs: state.now + 20 + sequence,
      payload: {
        wireVersion: "nanthai.runtime.process.v1",
        messageId: `worker-${sequence}`,
        sequence,
        sentAt: state.now + 20 + sequence,
        kind,
        payload,
      },
    },
  };
}

function adapterEvent(
  state: Awaited<ReturnType<typeof fixture>>,
  sequence: number,
  type: string,
  detail: Record<string, unknown>,
) {
  return {
    protocolVersion: "nanthai.runtime.v1", eventId: `adapter-${sequence}`,
    sequence, occurredAt: state.now + 20 + sequence,
    runId: String(state.execution.runId), attemptId: String(state.execution.attemptId),
    fence: state.execution.fence, sessionId: String(state.execution.attemptId),
    type, ...detail,
  };
}
