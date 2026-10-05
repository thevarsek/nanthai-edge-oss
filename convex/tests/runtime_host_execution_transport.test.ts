import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { createExecutionRun } from "../execution/runs";
import { enqueueRuntimeHostCommand } from "../runtime_host/command_transport";
import {
  claimRuntimeHostCommandHandler,
  completeRuntimeHostCommandHandler,
} from "../runtime_host/host_commands";
import {
  acquireConversationBindingHandler,
  advanceConversationFrontierHandler,
  resolveActiveConversationBinding,
} from "../runtime_host/conversation_bindings";
import { sha256Hex } from "../runtime_host/security";
import { registerRuntimeTurnPacket } from "../runtime_host/turn_packets";

type Rows = Record<string, Array<Record<string, unknown>>>;

async function fixture() {
  const now = Date.now();
  const rows: Rows = {
    chats: [{
      _id: "chat_1", userId: "user_1", title: "Runtime Test",
      mode: "group", createdAt: now, updatedAt: now,
    }],
    personas: [
      { _id: "persona_1", userId: "user_1", displayName: "Architect" },
      { _id: "persona_2", userId: "user_1", displayName: "Developer" },
    ],
    chatParticipants: [
      {
        _id: "participant_1", userId: "user_1", chatId: "chat_1",
        personaId: "persona_1", modelId: "openai/gpt-5.6", sortOrder: 0,
      },
      {
        _id: "participant_2", userId: "user_1", chatId: "chat_1",
        personaId: "persona_2", modelId: "openai/gpt-5.6", sortOrder: 1,
      },
    ],
    messages: [{
      _id: "message_1", userId: "user_1", chatId: "chat_1",
      role: "assistant", content: "Done", createdAt: now,
    }],
    runtimeDevices: [{
      _id: "runtime_device_1", userId: "user_1", deviceId: "device-1",
      displayName: "Dino MacBook", status: "active",
      currentPresenceId: "presence_1", currentCredentialId: "credential-1",
    }],
    runtimeDeviceCredentials: [{
      _id: "credential_row_1", userId: "user_1", runtimeDeviceId: "runtime_device_1",
      deviceId: "device-1", credentialId: "credential-1",
      credentialHash: await sha256Hex("secret-1"), status: "active", issuedAt: now,
    }],
    runtimeDevicePresences: [{
      _id: "presence_1", userId: "user_1", runtimeDeviceId: "runtime_device_1",
      deviceId: "device-1", presenceSessionId: "presence-session-1",
      status: "online", expiresAt: now + 1_000_000,
    }],
    accountDeletionTombstones: [],
    executionRuns: [],
    executionAttempts: [],
    runEvents: [],
    runtimeCommands: [],
    runtimeTurnPackets: [],
    executionComponentRefs: [],
    runtimeSessionBindings: [],
    runtimeConversationBindings: [],
    executionTeardownTasks: [],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  supportConversationBindingIndex(ctx, rows.runtimeConversationBindings);
  return { rows, ctx, now };
}

function supportConversationBindingIndex(
  ctx: MutationCtx,
  bindings: Array<Record<string, unknown>>,
): void {
  type IndexBuilder = { eq: (field: string, value: unknown) => IndexBuilder };
  type QueryChain = {
    withIndex: (name: string, build?: (query: IndexBuilder) => unknown) => QueryChain;
    unique: () => Promise<Record<string, unknown> | null>;
  };
  type MutableDatabase = { query: (table: string) => unknown };
  const database = ctx.db as unknown as MutableDatabase;
  const fallback = database.query.bind(database);
  database.query = (table: string) => {
    if (table !== "runtimeConversationBindings") return fallback(table);
    const filters: Array<[string, unknown]> = [];
    const builder: IndexBuilder = {
      eq: (field, value) => {
        filters.push([field, value]);
        return builder;
      },
    };
    const chain: QueryChain = {
      withIndex: (_name, build) => {
        build?.(builder);
        return chain;
      },
      unique: async () => bindings.find((binding) =>
        filters.every(([field, value]) => binding[field] === value),
      ) ?? null,
    };
    return chain;
  };
}

async function localExecution(
  ctx: MutationCtx,
  key: string,
  now: number,
  chatParticipantId = "participant_1",
  routeSnapshotHash = "route-hash-1",
) {
  return await createExecutionRun(ctx, {
    userId: "user_1",
    runKey: key,
    kind: "chat_generation",
    requestedPlacement: "local",
    chatId: "chat_1" as Id<"chats">,
    initialAttempt: {
      executorKind: "local_runtime",
      placement: "local",
      adapterId: "codex",
      deviceId: "device-1",
      chatParticipantId: chatParticipantId as Id<"chatParticipants">,
      routeSnapshotHash,
      orchestrationEngine: "runtime_adapter",
    },
    now,
  });
}

async function startCommand(
  ctx: MutationCtx,
  execution: Awaited<ReturnType<typeof localExecution>>,
  commandId: string,
  storageId: string,
  now: number,
) {
  const packetId = await registerRuntimeTurnPacket(ctx, {
    ...execution,
    runId: execution.runId,
    userId: "user_1",
    commandId,
    packetHash: commandId.startsWith("a") ? "a".repeat(64) : "b".repeat(64),
    storageId: storageId as Id<"_storage">,
    byteLength: 128,
    expiresAt: now + 60_000,
    now,
  });
  const commandRecordId = await enqueueRuntimeHostCommand(ctx, {
    ...execution,
    targetDeviceId: "device-1",
    commandId,
    type: "start",
    authorizationSource: "explicit_user_turn",
    initiatedBy: "user_1",
    turnPacketId: packetId,
    expiresAt: now + 60_000,
    now,
  });
  return { packetId, commandRecordId };
}

const host = {
  deviceId: "device-1",
  credentialId: "credential-1",
  credential: "secret-1",
  presenceSessionId: "presence-session-1",
};

test("one machine claims concurrent fenced Persona attempts without serializing the host", async () => {
  const { rows, ctx, now } = await fixture();
  const first = await localExecution(ctx, "local-a", now);
  const second = await localExecution(ctx, "local-b", now + 1);
  const firstCommand = await startCommand(ctx, first, "a-command", "storage-a", now + 2);
  const secondCommand = await startCommand(ctx, second, "b-command", "storage-b", now + 3);

  const [firstClaim, secondClaim] = await Promise.all([
    claimRuntimeHostCommandHandler(ctx, { ...host, commandRecordId: firstCommand.commandRecordId }),
    claimRuntimeHostCommandHandler(ctx, { ...host, commandRecordId: secondCommand.commandRecordId }),
  ]);
  assert.equal(firstClaim.claimed, true);
  assert.equal(secondClaim.claimed, true);
  assert.equal(rows.executionAttempts.filter((attempt) => attempt.status === "running").length, 2);
  assert.equal(rows.executionComponentRefs.length, 2);

  const replayed = await enqueueRuntimeHostCommand(ctx, {
    ...first,
    targetDeviceId: "device-1",
    commandId: "a-command",
    type: "start",
    authorizationSource: "explicit_user_turn",
    initiatedBy: "user_1",
    turnPacketId: firstCommand.packetId,
    expiresAt: now + 60_000,
    now: now + 4,
  });
  assert.equal(replayed, firstCommand.commandRecordId);
  await assert.rejects(enqueueRuntimeHostCommand(ctx, {
    ...first,
    fence: first.fence + 1,
    targetDeviceId: "device-1",
    commandId: "stale-command",
    type: "prompt",
    authorizationSource: "explicit_user_turn",
    initiatedBy: "user_1",
  }), /STALE_EXECUTION_FENCE/);

  assert.equal(await completeRuntimeHostCommandHandler(ctx, {
    ...host,
    commandRecordId: firstCommand.commandRecordId,
    status: "completed",
  }), true);
  assert.equal(rows.runtimeCommands[0].status, "completed");
});

test("durable conversation binding resumes by participant route and fences its frontier", async () => {
  const { rows, ctx, now } = await fixture();
  const execution = await localExecution(ctx, "conversation-a", now);
  const command = await startCommand(ctx, execution, "a-conversation", "storage-a", now + 1);
  await claimRuntimeHostCommandHandler(ctx, { ...host, commandRecordId: command.commandRecordId });
  const binding = await acquireConversationBindingHandler(ctx, {
    ...host,
    attemptId: execution.attemptId,
    fence: execution.fence,
    nativeSessionId: "codex-thread-1",
    threadName: "Architect · Runtime Test",
  });
  const resolved = await resolveActiveConversationBinding(ctx, {
    userId: "user_1",
    chatParticipantId: "participant_1" as Id<"chatParticipants">,
    routeSnapshotHash: "route-hash-1",
    deviceId: "device-1",
    adapterId: "codex",
  });
  assert.equal(resolved?.nativeSessionId, "codex-thread-1");

  await advanceConversationFrontierHandler(ctx, {
    ...host,
    conversationBindingId: binding.conversationBindingId,
    attemptId: execution.attemptId,
    fence: execution.fence,
    canonicalFrontierMessageId: "message_1" as Id<"messages">,
    nativeTurnId: "native-turn-1",
  });
  assert.equal(rows.runtimeConversationBindings[0].canonicalFrontierMessageId, "message_1");
  await assert.rejects(advanceConversationFrontierHandler(ctx, {
    ...host,
    conversationBindingId: binding.conversationBindingId,
    attemptId: execution.attemptId,
    fence: execution.fence,
    canonicalFrontierMessageId: "message_1" as Id<"messages">,
    nativeTurnId: "native-turn-replay",
  }), /frontier changed/);

  const other = await localExecution(
    ctx,
    "conversation-b",
    now + 2,
    "participant_2",
    "route-hash-2",
  );
  const otherCommand = await startCommand(
    ctx,
    other,
    "b-conversation",
    "storage-b",
    now + 3,
  );
  await claimRuntimeHostCommandHandler(ctx, {
    ...host,
    commandRecordId: otherCommand.commandRecordId,
  });
  await assert.rejects(acquireConversationBindingHandler(ctx, {
    ...host,
    attemptId: other.attemptId,
    fence: other.fence,
    nativeSessionId: "codex-thread-1",
    threadName: "Developer · Runtime Test",
  }), /already owned by another Persona route/);
});
