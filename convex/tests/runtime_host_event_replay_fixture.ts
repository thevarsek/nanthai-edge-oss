import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { sha256Hex } from "../runtime_host/security";

type Rows = Record<string, Array<Record<string, unknown>>>;

export const oldHost = {
  deviceId: "device-1",
  credentialId: "credential-1",
  credential: "secret-1",
  presenceSessionId: "presence-old",
};
export const restartedHost = { ...oldHost, presenceSessionId: "presence-new" };

export async function fixture() {
  const now = Date.now();
  const claimantId = "runtime-host:device-1:presence-old";
  const rows: Rows = {
    accountDeletionTombstones: [],
    chats: [{
      _id: "chat-1", userId: "user-1", title: "Runtime chat",
      mode: "group", createdAt: now, updatedAt: now,
    }],
    messages: [{
      _id: "message-1", userId: "user-1", chatId: "chat-1",
      role: "assistant", content: "", status: "streaming", createdAt: now,
    }],
    streamingMessages: [{
      _id: "stream-1", userId: "user-1", chatId: "chat-1",
      messageId: "message-1", content: "Canonical answer", status: "streaming",
      createdAt: now, updatedAt: now,
    }],
    generationJobs: [{
      _id: "job-1", userId: "user-1", chatId: "chat-1", messageId: "message-1",
      status: "streaming", streamingMessageId: "stream-1",
      runtimeCommandRecordId: "command-record-1",
      executionRunId: "run-1", executionAttemptId: "attempt-1", executionFence: 7,
      createdAt: now,
    }],
    generationContinuations: [],
    executionRuns: [{
      _id: "run-1", userId: "user-1", chatId: "chat-1",
      generationJobId: "job-1", kind: "chat_generation", state: "running",
      requestedPlacement: "local", activeAttemptId: "attempt-1",
      nextAttemptNumber: 2, nextFence: 8, nextEventSequence: 0,
      createdAt: now, updatedAt: now,
    }],
    executionAttempts: [{
      _id: "attempt-1", runId: "run-1", userId: "user-1", attemptNumber: 1,
      executorKind: "local_runtime", placement: "local", adapterId: "codex",
      deviceId: "device-1", protocolVersion: "nanthai.runtime.v1",
      status: "running", claimantId, fence: 7, leaseExpiresAt: now + 60_000,
      runtimeLastWorkerSequence: 4,
      runtimeLastWorkerEventId: "command-1:worker:4",
      createdAt: now, updatedAt: now,
    }],
    runtimeCommands: [{
      _id: "command-record-1", runId: "run-1", attemptId: "attempt-1",
      userId: "user-1", commandId: "command-1", expectedFence: 7,
      type: "start", status: "acknowledged",
      authorizationSource: "explicit_user_turn", initiatedBy: "user-1",
      inputHash: "hash-1", targetDeviceId: "device-1",
      claimedBy: claimantId, claimedAt: now, acknowledgedAt: now,
      createdAt: now, updatedAt: now,
    }],
    runtimeDevices: [{
      _id: "device-row-1", userId: "user-1", deviceId: "device-1",
      displayName: "Mac", status: "active", currentCredentialId: "credential-1",
      currentPresenceId: "presence-row-old", createdAt: now, updatedAt: now,
    }],
    runtimeDeviceCredentials: [{
      _id: "credential-row-1", userId: "user-1", runtimeDeviceId: "device-row-1",
      deviceId: "device-1", credentialId: "credential-1", status: "active",
      credentialHash: await sha256Hex("secret-1"), issuedAt: now,
    }],
    runtimeDevicePresences: [{
      _id: "presence-row-old", userId: "user-1", runtimeDeviceId: "device-row-1",
      deviceId: "device-1", credentialId: "credential-1",
      presenceSessionId: "presence-old", status: "online", expiresAt: now + 60_000,
    }],
    runtimeSessionBindings: [],
    runtimeConversationBindings: [],
    executionComponentRefs: [],
    runEvents: [],
    usageRecords: [],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  return { ctx, rows, now };
}

export function workerEvent(
  sequence: number,
  kind: "terminal_event" | "command_result",
) {
  const payload = kind === "terminal_event"
    ? {
        sessionId: "attempt-1",
        event: {
          protocolVersion: "nanthai.runtime.v1", eventId: "adapter-terminal-1",
          sequence, occurredAt: 1_786_752_000_000, runId: "run-1",
          attemptId: "attempt-1", fence: 7, sessionId: "attempt-1",
          type: "terminal", outcome: "completed", summary: "Turn completed",
          errorCode: null, checkpointRef: null,
        },
      }
    : {
        requestMessageId: "host-send-turn-1", status: "completed",
        code: null, summary: "Turn completed",
      };
  return {
    eventId: `command-1:worker:${sequence}`,
    commandRecordId: "command-record-1" as Id<"runtimeCommands">,
    commandId: "command-1",
    runId: "run-1" as Id<"executionRuns">,
    attemptId: "attempt-1" as Id<"executionAttempts">,
    fence: 7,
    kind: "worker_message" as const,
    emittedAtMs: 1_786_752_000_000 + sequence,
    payload: {
      wireVersion: "nanthai.runtime.process.v1",
      messageId: `worker-${sequence}`,
      sequence,
      sentAt: 1_786_752_000_000 + sequence,
      kind,
      payload,
    },
  };
}

export function hostFailure() {
  return {
    eventId: "command-1:host-failure",
    commandRecordId: "command-record-1" as Id<"runtimeCommands">,
    commandId: "command-1",
    runId: "run-1" as Id<"executionRuns">,
    attemptId: "attempt-1" as Id<"executionAttempts">,
    fence: 7,
    kind: "host_command_failed" as const,
    emittedAtMs: 1_786_752_000_007,
    payload: { message: "Control-plane ACK failed after terminal output" },
  };
}

export function restart(rows: Rows, now: number): void {
  Object.assign(rows.runtimeDevicePresences[0], {
    status: "superseded", expiresAt: now - 1,
  });
  rows.runtimeDevicePresences.push({
    _id: "presence-row-new", userId: "user-1", runtimeDeviceId: "device-row-1",
    deviceId: "device-1", credentialId: "credential-1",
    presenceSessionId: "presence-new", status: "online", expiresAt: now + 60_000,
  });
  rows.runtimeDevices[0].currentPresenceId = "presence-row-new";
}

export function canonicalState(rows: Rows) {
  return {
    message: { ...rows.messages[0] },
    job: { ...rows.generationJobs[0] },
    run: { ...rows.executionRuns[0] },
    command: { ...rows.runtimeCommands[0] },
    runEvents: rows.runEvents.map((event) => ({ ...event })),
  };
}
