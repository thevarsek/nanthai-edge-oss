import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  getRuntimeAttachmentForHost,
  registerRuntimeAttachmentFetchHandles,
  type RuntimeAttachmentGrantInput,
} from "../runtime_host/attachment_fetch_handles";
import { fetchRuntimeAttachmentHttp } from "../runtime_host/http_attachments";
import { sha256Hex } from "../runtime_host/security";
import {
  createMockCtx,
  createStatefulMockCtx,
} from "../../test_helpers/convex_mock_ctx";

const now = 10_000;
const expiresAt = now + 60_000;
const handle = "rfa_00000000-0000-4000-8000-000000000001";
const host = {
  deviceId: "device-1",
  credentialId: "credential-1",
  credential: "secret-1",
  presenceSessionId: "presence-session-1",
};

async function claimedRows() {
  const claimantId = "runtime-host:device-1:presence-session-1";
  return {
    runtimeDevices: [{
      _id: "runtime-device-1",
      userId: "user-1",
      deviceId: "device-1",
      status: "active",
    }],
    runtimeDeviceCredentials: [{
      _id: "credential-row-1",
      userId: "user-1",
      runtimeDeviceId: "runtime-device-1",
      deviceId: "device-1",
      credentialId: "credential-1",
      credentialHash: await sha256Hex("secret-1"),
      status: "active",
    }],
    runtimeDevicePresences: [{
      _id: "presence-1",
      userId: "user-1",
      runtimeDeviceId: "runtime-device-1",
      deviceId: "device-1",
      credentialId: "credential-1",
      presenceSessionId: "presence-session-1",
      status: "online",
      expiresAt,
    }],
    runtimeAttachmentFetchHandles: [{
      _id: "attachment-handle-1",
      userId: "user-1",
      turnPacketId: "packet-1",
      sourceMessageId: "message-1",
      handle,
      storageId: "storage-image-1",
      mimeType: "image/png",
      byteLength: 10,
      maxChunkBytes: 4,
      sha256: "a".repeat(64),
      expiresAt,
    }],
    runtimeTurnPackets: [{
      _id: "packet-1",
      runId: "run-1",
      attemptId: "attempt-1",
      fence: 1,
      userId: "user-1",
      commandId: "turn-1",
      expiresAt,
    }],
    executionRuns: [{
      _id: "run-1",
      userId: "user-1",
      chatId: "chat-1",
      activeAttemptId: "attempt-1",
      state: "running",
    }],
    executionAttempts: [{
      _id: "attempt-1",
      runId: "run-1",
      userId: "user-1",
      fence: 1,
      status: "running",
      placement: "local",
      executorKind: "local_runtime",
      deviceId: "device-1",
      claimantId,
      leaseExpiresAt: expiresAt,
    }],
    runtimeCommands: [{
      _id: "command-record-1",
      turnPacketId: "packet-1",
      runId: "run-1",
      attemptId: "attempt-1",
      userId: "user-1",
      commandId: "turn-1",
      expectedFence: 1,
      type: "start",
      status: "acknowledged",
      targetDeviceId: "device-1",
      claimedBy: claimantId,
      expiresAt,
    }],
  };
}

test("attachment grant resolves only for the exact active claimed command", async () => {
  const rows = await claimedRows();
  const ctx = createStatefulMockCtx(rows) as unknown as QueryCtx;
  const grant = await getRuntimeAttachmentForHost(ctx, { ...host, handle }, now);
  assert.deepEqual(grant, {
    storageId: "storage-image-1",
    mimeType: "image/png",
    byteLength: 10,
    maxChunkBytes: 4,
    sha256: "a".repeat(64),
    expiresAt,
  });

  rows.runtimeCommands[0].status = "pending";
  assert.equal(await getRuntimeAttachmentForHost(ctx, { ...host, handle }, now), null);
  rows.runtimeCommands[0].status = "acknowledged";
  rows.runtimeCommands[0].claimedBy = "runtime-host:device-1:other-presence";
  assert.equal(await getRuntimeAttachmentForHost(ctx, { ...host, handle }, now), null);
  rows.runtimeCommands[0].claimedBy = "runtime-host:device-1:presence-session-1";
  rows.executionAttempts[0].fence = 2;
  assert.equal(await getRuntimeAttachmentForHost(ctx, { ...host, handle }, now), null);
  await assert.rejects(
    getRuntimeAttachmentForHost(ctx, { ...host, handle, credential: "forged" }, now),
    /credential is invalid or revoked/,
  );
});

function grantInput(overrides: Partial<RuntimeAttachmentGrantInput> = {}) {
  return {
    sourceMessageId: "message-1" as Id<"messages">,
    handle,
    storageId: "storage-image-1" as Id<"_storage">,
    mimeType: "image/png",
    byteLength: 10,
    maxChunkBytes: 4 * 1024 * 1024,
    sha256: "a".repeat(64),
    expiresAt,
    ...overrides,
  };
}

test("registration binds only canonical owned message storage and is idempotent", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    executionRuns: [{ _id: "run-1", userId: "user-1", chatId: "chat-1" }],
    runtimeTurnPackets: [{
      _id: "packet-1", runId: "run-1", userId: "user-1", expiresAt,
    }],
    messages: [{
      _id: "message-1",
      chatId: "chat-1",
      attachments: [{
        type: "image",
        storageId: "storage-image-1",
        mimeType: "image/png",
        sizeBytes: 10,
      }],
    }],
    runtimeAttachmentFetchHandles: [],
  };
  let metadataSize = 10;
  const ctx = createStatefulMockCtx(rows, {
    storage: {
      getMetadata: async () => ({ size: metadataSize, contentType: "image/png" }),
    },
  }) as unknown as MutationCtx;
  const args = {
    turnPacketId: "packet-1" as Id<"runtimeTurnPackets">,
    grants: [grantInput()],
    now,
  };
  const first = await registerRuntimeAttachmentFetchHandles(ctx, args);
  const replay = await registerRuntimeAttachmentFetchHandles(ctx, args);
  assert.deepEqual(replay, first);
  assert.equal(rows.runtimeAttachmentFetchHandles.length, 1);

  rows.messages.push({ _id: "message-2", chatId: "chat-2", attachments: [{
    type: "image",
    storageId: "storage-image-1",
    mimeType: "image/png",
    sizeBytes: 10,
  }] });
  await assert.rejects(registerRuntimeAttachmentFetchHandles(ctx, {
    ...args,
    grants: [grantInput({
      handle: "rfa_00000000-0000-4000-8000-000000000002",
      sourceMessageId: "message-2" as Id<"messages">,
    })],
  }), /owned canonical message image/);
  metadataSize = 9;
  await assert.rejects(registerRuntimeAttachmentFetchHandles(ctx, {
    ...args,
    grants: [grantInput({
      handle: "rfa_00000000-0000-4000-8000-000000000003",
    })],
  }), /storage does not match its manifest/);
});

const authHeaders = {
  Authorization: "Bearer secret-1",
  "X-NanthAI-Device-ID": "device-1",
  "X-NanthAI-Credential-ID": "credential-1",
  "X-NanthAI-Presence-Session-ID": "presence-session-1",
  "Content-Type": "application/json",
};

function fetchRequest(body: unknown): Request {
  return new Request("https://runtime.example/runtime-host/v1/attachments/fetch", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });
}

test("HTTP attachment fetch returns bounded integrity-labelled 206 chunks", async () => {
  const bytes = new TextEncoder().encode("0123456789");
  const blob = new Blob([bytes], { type: "image/png" });
  const ctx = createMockCtx({
    runQuery: async () => ({
      storageId: "storage-image-1",
      mimeType: "image/png",
      byteLength: 10,
      maxChunkBytes: 4,
      sha256: "a".repeat(64),
      expiresAt,
    }),
    storage: { get: async () => blob },
  });
  const first = await fetchRuntimeAttachmentHttp(
    ctx,
    fetchRequest({ handle, offset: 0, maxBytes: 4 }),
  );
  assert.equal(first.status, 206);
  assert.equal(await first.text(), "0123");
  assert.equal(first.headers.get("Content-Range"), "bytes 0-3/10");
  assert.equal(first.headers.get("X-NanthAI-Attachment-Offset"), "0");
  assert.equal(first.headers.get("X-NAnthAI-Attachment-Byte-Length"), "10");
  assert.equal(first.headers.get("ETag"), `"${"a".repeat(64)}"`);

  const last = await fetchRuntimeAttachmentHttp(
    ctx,
    fetchRequest({ handle, offset: 8, maxBytes: 4 }),
  );
  assert.equal(last.status, 206);
  assert.equal(await last.text(), "89");
  assert.equal(last.headers.get("Content-Range"), "bytes 8-9/10");

  const invalid = await fetchRuntimeAttachmentHttp(
    ctx,
    fetchRequest({ handle, offset: 10, maxBytes: 4 }),
  );
  assert.equal(invalid.status, 416);
  const overGrant = await fetchRuntimeAttachmentHttp(
    ctx,
    fetchRequest({ handle, offset: 0, maxBytes: 5 }),
  );
  assert.equal(overGrant.status, 416);

  const corrupt = await fetchRuntimeAttachmentHttp(createMockCtx({
    runQuery: ctx.runQuery,
    storage: { get: async () => new Blob([bytes], { type: "image/jpeg" }) },
  }), fetchRequest({ handle, offset: 0, maxBytes: 4 }));
  assert.equal(corrupt.status, 409);
});
