import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { heartbeat, heartbeatPresenceHandler } from "../runtime_host/presence";
import { heartbeatPresenceHttp } from "../runtime_host/http_pairing_presence";
import { PAIRING_PROTOCOL_VERSION } from "../runtime_host/protocol_common";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import { createPermissionFixture, permissionHost } from "./runtime_host_permission_fixture";

type Args = Parameters<typeof heartbeatPresenceHandler>[1] & { protocolVersion: typeof PAIRING_PROTOCOL_VERSION };
type Result = { presenceId: string; serverTime: number; expiresAt: number }
  | { error: { code: "UNAUTHORIZED"; message: string } };
const runHeartbeat = (heartbeat as unknown as {
  _handler: (ctx: MutationCtx, args: Args) => Promise<Result>;
})._handler;

test("revoked and invalid hosts receive a normal denial without writes or function errors", async () => {
  for (const rejection of ["credential_revoked", "device_revoked", "wrong_secret"] as const) {
    const { ctx, rows } = await createPermissionFixture();
    if (rejection === "credential_revoked") rows.runtimeDeviceCredentials[0].status = "revoked";
    if (rejection === "device_revoked") rows.runtimeDevices[0].status = "revoked";
    const args: Args = {
      ...permissionHost, protocolVersion: PAIRING_PROTOCOL_VERSION, owner: "tray",
      credential: rejection === "wrong_secret" ? "wrong-secret" : permissionHost.credential,
      connectedAt: 1, heartbeatAt: 1, hostVersion: "0.4.3", adapters: [],
      platform: { operatingSystem: "macos", architecture: "arm64", release: "26.0" },
    };
    const before = structuredClone(rows);
    const expected = { error: { code: "UNAUTHORIZED", message: "Runtime Host credential is invalid or revoked" } };
    assert.deepEqual(await runHeartbeat(ctx, args), expected);
    assert.deepEqual(rows, before);
    const httpCtx = createMockCtx({ runMutation: async () => await runHeartbeat(ctx, args) });
    const response = await heartbeatPresenceHttp(httpCtx, new Request("https://runtime.example/runtime-host/v1/presence/heartbeat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${args.credential}`,
        "X-NanthAI-Device-ID": args.deviceId,
        "X-NanthAI-Credential-ID": args.credentialId,
        "X-NanthAI-Presence-Session-ID": args.presenceSessionId,
      },
      body: JSON.stringify({ ...args, credential: undefined }),
    }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), expected);
    assert.deepEqual(rows, before);
  }
});

test("unexpected heartbeat failures still surface as errors", async () => {
  const { ctx } = await createPermissionFixture();
  ctx.db.query = () => { throw new Error("database unavailable"); };
  await assert.rejects(runHeartbeat(ctx, {
    ...permissionHost, protocolVersion: PAIRING_PROTOCOL_VERSION, owner: "tray",
    connectedAt: 1, heartbeatAt: 1, hostVersion: "0.4.4", adapters: [],
    platform: { operatingSystem: "macos", architecture: "arm64", release: "26.0" },
  }), /database unavailable/);
});
