import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { sha256Hex } from "../runtime_host/security";

export type PermissionRows = Record<string, Array<Record<string, unknown>>>;

export const permissionHost = {
  deviceId: "device-1",
  credentialId: "credential-1",
  credential: "secret-1",
  presenceSessionId: "presence-1",
};

export async function createPermissionFixture(now = Date.now()) {
  const claimantId = "runtime-host:device-1:presence-1";
  const rows: PermissionRows = {
    accountDeletionTombstones: [],
    chats: [{
      _id: "chat-1", userId: "user_1", title: "Runtime permissions",
      mode: "single", createdAt: now, updatedAt: now,
    }],
    chatParticipants: [{
      _id: "participant-1", chatId: "chat-1", userId: "user_1",
      personaId: "persona-1", modelId: "openai/gpt-test", createdAt: now,
    }],
    messages: [{
      _id: "message-1", userId: "user_1", chatId: "chat-1",
      role: "assistant", content: "", status: "streaming", createdAt: now,
    }],
    streamingMessages: [{
      _id: "stream-1", userId: "user_1", chatId: "chat-1",
      messageId: "message-1", content: "", status: "streaming",
      createdAt: now, updatedAt: now,
    }],
    generationJobs: [{
      _id: "job-1", userId: "user_1", chatId: "chat-1", messageId: "message-1",
      status: "streaming", streamingMessageId: "stream-1",
      runtimeCommandRecordId: "command-1", executionRunId: "run-1",
      executionAttemptId: "attempt-1", executionFence: 7, createdAt: now,
    }],
    generationContinuations: [],
    executionRuns: [{
      _id: "run-1", userId: "user_1", chatId: "chat-1",
      generationJobId: "job-1", kind: "chat_generation", state: "running",
      requestedPlacement: "local", activeAttemptId: "attempt-1",
      nextAttemptNumber: 2, nextFence: 8, nextEventSequence: 0,
      createdAt: now, updatedAt: now,
    }],
    executionAttempts: [{
      _id: "attempt-1", runId: "run-1", userId: "user_1", attemptNumber: 1,
      executorKind: "local_runtime", placement: "local", adapterId: "codex",
      adapterVersion: "1.0.0", deviceId: "device-1",
      chatParticipantId: "participant-1", protocolVersion: "nanthai.runtime.v1",
      status: "running", claimantId, fence: 7, leaseExpiresAt: now + 120_000,
      heartbeatAt: now, createdAt: now, updatedAt: now,
    }],
    runtimeCommands: [{
      _id: "command-1", runId: "run-1", attemptId: "attempt-1",
      userId: "user_1", commandId: "turn-1", expectedFence: 7,
      type: "start", status: "acknowledged",
      authorizationSource: "explicit_user_turn", initiatedBy: "user_1",
      inputHash: "hash", targetDeviceId: "device-1", claimedBy: claimantId,
      claimedAt: now, acknowledgedAt: now, createdAt: now, updatedAt: now,
    }],
    runtimeDevices: [{
      _id: "device-row-1", userId: "user_1", deviceId: "device-1",
      displayName: "Dino MacBook", status: "active",
      currentCredentialId: "credential-1", currentPresenceId: "presence-row-1",
      createdAt: now, updatedAt: now,
    }],
    runtimeDeviceCredentials: [{
      _id: "credential-row-1", userId: "user_1", runtimeDeviceId: "device-row-1",
      deviceId: "device-1", credentialId: "credential-1", status: "active",
      credentialHash: await sha256Hex("secret-1"), issuedAt: now,
    }],
    runtimeDevicePresences: [{
      _id: "presence-row-1", userId: "user_1", runtimeDeviceId: "device-row-1",
      deviceId: "device-1", credentialId: "credential-1",
      presenceSessionId: "presence-1", status: "online", expiresAt: now + 120_000,
      adapters: [{
        adapterId: "codex", adapterVersion: "1.0.0", authState: "ready",
        capabilities: {
          protocolVersion: "nanthai.runtime.v1", adapterId: "codex",
          adapterVersion: "1.0.0", transport: "stdio_jsonrpc",
          inputModalities: ["text", "image"],
          eventTypes: ["permission_requested", "permission_resolved", "terminal"],
          operations: {
            listModels: true, cancel: true, resume: true,
            permissionResponse: true, inputResponse: true,
          },
          adapterNative: { tools: true, plugins: true, mcpServers: true, skills: true },
        },
      }],
    }],
    runtimeSessionBindings: [{
      _id: "session-binding-1", runId: "run-1", attemptId: "attempt-1",
      userId: "user_1", adapterId: "codex", bindingKey: "conversation:test",
      fence: 7, status: "active", nativeSessionId: "native-1",
      deviceId: "device-1", boundAt: now,
    }],
    runtimePermissionRequests: [],
    runtimeNativeAgentGroups: [],
    runtimeNativeAgents: [],
    runtimeConversationBindings: [],
    executionComponentRefs: [],
    executionOperations: [],
    executionTeardownTasks: [],
    runEvents: [],
    usageRecords: [],
  };
  const state = createStatefulMockCtx(rows);
  supportPermissionIndexes(state as unknown as MutationCtx, rows.runtimePermissionRequests);
  return { rows, state, ctx: state as unknown as MutationCtx, now };
}

export function permissionRequestedEvent(
  sequence: number,
  now: number,
  options: {
    eventId?: string;
    permissionRequestId?: string;
    expiresAt?: number | null;
    nativeAgentThreadId?: string | null;
  } = {},
) {
  const eventId = options.eventId ?? `permission-request-${sequence}`;
  return workerEvent(sequence, now, "adapter_event", {
    sessionId: "attempt-1",
    event: {
      protocolVersion: "nanthai.runtime.v1", eventId, sequence,
      occurredAt: now + sequence, runId: "run-1", attemptId: "attempt-1",
      fence: 7, sessionId: "attempt-1", type: "permission_requested",
      permissionRequestId: options.permissionRequestId ?? "native-request-1",
      nativeAgentThreadId: options.nativeAgentThreadId ?? null,
      toolCallId: "tool-1", permissionKind: "command_execution",
      prompt: "Allow Codex to run the test command?",
      choices: ["allow_once", "allow_session", "deny", "cancel"],
      expiresAt: options.expiresAt ?? null,
    },
  });
}

export function permissionResolvedEvent(
  sequence: number,
  now: number,
  decision: "allow_once" | "allow_session" | "deny" | "cancel",
  permissionRequestId = "native-request-1",
  command?: { commandRecordId: Id<"runtimeCommands">; commandId: string },
) {
  return workerEvent(sequence, now, "adapter_event", {
    sessionId: "attempt-1",
    event: {
      protocolVersion: "nanthai.runtime.v1", eventId: `permission-resolved-${sequence}`,
      sequence, occurredAt: now + sequence, runId: "run-1", attemptId: "attempt-1",
      fence: 7, sessionId: "attempt-1", type: "permission_resolved",
      permissionRequestId, decision,
    },
  }, command);
}

export function commandResultEvent(
  sequence: number,
  now: number,
  commandRecordId: Id<"runtimeCommands">,
  commandId: string,
) {
  return workerEvent(sequence, now, "command_result", {
    requestMessageId: "permission-response-1", status: "completed",
    code: null, summary: "Permission response delivered",
  }, { commandRecordId, commandId });
}

function workerEvent(
  sequence: number,
  now: number,
  kind: "adapter_event" | "command_result",
  payload: unknown,
  command: { commandRecordId: Id<"runtimeCommands">; commandId: string } = {
    commandRecordId: "command-1" as Id<"runtimeCommands">,
    commandId: "turn-1",
  },
) {
  return {
    eventId: `${command.commandId}:worker:${sequence}`,
    commandRecordId: command.commandRecordId,
    commandId: command.commandId,
    runId: "run-1" as Id<"executionRuns">,
    attemptId: "attempt-1" as Id<"executionAttempts">,
    fence: 7,
    kind: "worker_message" as const,
    emittedAtMs: now + sequence,
    payload: {
      wireVersion: "nanthai.runtime.process.v1", messageId: `worker-${sequence}`,
      sequence, sentAt: now + sequence, kind, payload,
    },
  };
}

function supportPermissionIndexes(ctx: MutationCtx, requests: Array<Record<string, unknown>>) {
  type Builder = { eq: (field: string, value: unknown) => Builder };
  const database = ctx.db as unknown as { query: (table: string) => unknown };
  const fallback = database.query.bind(database) as (table: string) => unknown;
  database.query = (table: string) => {
    if (table !== "runtimePermissionRequests") return fallback(table);
    const filters: Array<[string, unknown]> = [];
    let descending = false;
    const builder: Builder = { eq: (field, value) => {
      filters.push([field, value]);
      return builder;
    } };
    const matching = () => {
      const values = requests.filter((row) =>
        filters.every(([field, value]) => row[field] === value)
      );
      return descending ? values.reverse() : values;
    };
    const chain = {
      withIndex: (_name: string, build?: (query: Builder) => unknown) => {
        build?.(builder);
        return chain;
      },
      order: (direction: "asc" | "desc") => {
        descending = direction === "desc";
        return chain;
      },
      collect: async () => matching(),
      take: async (count: number) => matching().slice(0, count),
      first: async () => matching()[0] ?? null,
      unique: async () => matching()[0] ?? null,
    };
    return chain;
  };
}
