import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { pendingWorkForHostHandler } from "../runtime_host/host_watch";
import { realtimeEndpointHttp } from "../runtime_host/http_commands";
import { sha256Hex } from "../runtime_host/security";

type Row = Record<string, any>;

const host = {
  deviceId: "device-1",
  credentialId: "credential-1",
  credential: "secret-1",
  presenceSessionId: "presence-session-1",
};

async function fixture() {
  const rows: Record<string, Row[]> = {
    runtimeDevices: [
      { _id: "runtime-device-1", userId: "user-1", deviceId: "device-1", status: "active" },
      { _id: "runtime-device-2", userId: "user-2", deviceId: "device-2", status: "active" },
    ],
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
      expiresAt: 10_000,
    }],
    runtimeCommands: [
      { _id: "command-1", targetDeviceId: "device-1", status: "pending", payload: "secret prompt" },
      { _id: "command-2", targetDeviceId: "device-1", status: "acknowledged" },
      { _id: "command-3", targetDeviceId: "device-2", status: "pending" },
    ],
    runtimeModelDiscoveryRequests: [
      { _id: "discovery-1", runtimeDeviceId: "runtime-device-1", presenceSessionId: "presence-session-1", status: "pending" },
      { _id: "discovery-2", runtimeDeviceId: "runtime-device-1", presenceSessionId: "old-session", status: "pending" },
      { _id: "discovery-3", runtimeDeviceId: "runtime-device-1", presenceSessionId: "presence-session-1", status: "claimed" },
    ],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as QueryCtx;
  return { rows, ctx };
}

test("pending work watch returns only this host's pending record IDs", async () => {
  const { ctx } = await fixture();
  const work = await pendingWorkForHostHandler(ctx, host, 1_000);
  assert.deepEqual(work, {
    commandIds: ["command-1"],
    modelDiscoveryRequestIds: ["discovery-1"],
  });
  assert.equal(JSON.stringify(work).includes("secret prompt"), false);
});

test("pending work watch rejects wrong, revoked, and offline credentials", async () => {
  const { rows, ctx } = await fixture();
  await assert.rejects(
    pendingWorkForHostHandler(ctx, { ...host, credential: "guess" }, 1_000),
    /invalid or revoked/i,
  );
  await assert.rejects(
    pendingWorkForHostHandler(ctx, { ...host, deviceId: "device-2" }, 1_000),
    /invalid or revoked/i,
  );
  await assert.rejects(
    pendingWorkForHostHandler(ctx, host, 10_000),
    /presence has expired/i,
  );
  rows.runtimeDevices[0].status = "revoked";
  await assert.rejects(pendingWorkForHostHandler(ctx, host, 1_000), /invalid or revoked/i);
  rows.runtimeDevices[0].status = "active";
  rows.runtimeDeviceCredentials[0].status = "revoked";
  await assert.rejects(pendingWorkForHostHandler(ctx, host, 1_000), /invalid or revoked/i);
});

test("pending work watch withholds discovery while presence awaits credential rebind", async () => {
  const { rows, ctx } = await fixture();
  rows.runtimeDevicePresences[0].credentialId = "credential-0";
  assert.deepEqual(await pendingWorkForHostHandler(ctx, host, 1_000), {
    commandIds: ["command-1"],
    modelDiscoveryRequestIds: [],
  });
});

test("realtime endpoint returns the deployment URL or reports it unavailable", async () => {
  const previous = process.env.CONVEX_CLOUD_URL;
  try {
    process.env.CONVEX_CLOUD_URL = "https://example-123.convex.cloud";
    const available = await realtimeEndpointHttp();
    assert.equal(available.status, 200);
    assert.deepEqual(await available.json(), { realtimeUrl: "https://example-123.convex.cloud" });
    delete process.env.CONVEX_CLOUD_URL;
    assert.equal((await realtimeEndpointHttp()).status, 404);
  } finally {
    if (previous === undefined) delete process.env.CONVEX_CLOUD_URL;
    else process.env.CONVEX_CLOUD_URL = previous;
  }
});
