import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { deleteAccountStorageBatch } from "../account/mutations_storage_cleanup";
import { createExecutionRun } from "../execution/runs";
import { registerRuntimeTurnPacket } from "../runtime_host/turn_packets";
import { expireRuntimeTurnPacketHandler } from "../runtime_host/turn_packet_expiry";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

test("runtime turn packet envelopes schedule and reclaim their storage at expiry", async () => {
  const now = Date.now();
  const rows: Record<string, Array<Record<string, unknown>>> = {
    executionRuns: [],
    executionAttempts: [],
    runEvents: [],
    runtimeTurnPackets: [],
    runtimeAttachmentFetchHandles: [],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx & {
    scheduled: Array<Record<string, unknown>>;
    storageDeletes: string[];
  };
  const execution = await createExecutionRun(ctx, {
    userId: "user_1",
    runKey: "packet-expiry",
    kind: "chat_generation",
    requestedPlacement: "local",
    initialAttempt: {
      executorKind: "local_runtime",
      placement: "local",
      adapterId: "codex",
      deviceId: "device-1",
      orchestrationEngine: "runtime_adapter",
    },
    now,
  });
  const expiresAt = now + 60_000;
  const packetId = await registerRuntimeTurnPacket(ctx, {
    ...execution,
    runId: execution.runId,
    userId: "user_1",
    commandId: "turn-1",
    packetHash: "a".repeat(64),
    storageId: "storage-expiry" as Id<"_storage">,
    byteLength: 128,
    expiresAt,
    now,
  });
  rows.runtimeAttachmentFetchHandles.push({
    _id: "attachment-handle-1",
    userId: "user_1",
    turnPacketId: packetId,
    storageId: "canonical-image-storage",
  });

  assert.ok(ctx.scheduled.some((entry) => entry.turnPacketId === packetId));
  assert.equal(await expireRuntimeTurnPacketHandler(ctx, {
    turnPacketId: packetId,
    expectedExpiresAt: expiresAt,
    now: expiresAt - 1,
  }), false);
  assert.equal(await expireRuntimeTurnPacketHandler(ctx, {
    turnPacketId: packetId,
    expectedExpiresAt: expiresAt,
    now: expiresAt,
  }), true);
  assert.equal(rows.runtimeTurnPackets.length, 0);
  assert.equal(rows.runtimeAttachmentFetchHandles.length, 0);
  assert.deepEqual(ctx.storageDeletes, ["storage-expiry"]);
});

test("account deletion reclaims owned runtime packet blobs", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    runtimeTurnPackets: [
      { _id: "packet_1", userId: "user_1", storageId: "storage_1" },
      { _id: "packet_2", userId: "user_2", storageId: "storage_2" },
    ],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx & {
    storageDeletes: string[];
  };
  const deleted = await deleteAccountStorageBatch(
    ctx,
    "runtimeTurnPackets",
    "user_1",
    200,
  );
  assert.equal(deleted, 1);
  assert.deepEqual(ctx.storageDeletes, ["storage_1"]);
  assert.deepEqual(rows.runtimeTurnPackets.map((row) => row._id), ["packet_2"]);
});
