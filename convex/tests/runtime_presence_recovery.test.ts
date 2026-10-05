import assert from "node:assert/strict";
import test from "node:test";
import type { Id, TableNames } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createPermissionFixture, permissionHost } from "./runtime_host_permission_fixture";
import { heartbeatPresenceHandler } from "../runtime_host/presence";
import { expireRuntimePresenceHandler } from "../runtime_host/presence_expiry";
import { authenticateOnlineRuntimeHost } from "../runtime_host/host_session_auth";
import { listPending } from "../runtime_host/host_commands";

test("an expired same-process session renews in place and can authenticate and poll commands", async () => {
  const now = Date.now();
  const { ctx, rows } = await createPermissionFixture(now);
  // Enforce Convex's actual cardinality; the broad fixture's unique() returns first.
  const queryTable = ctx.db.query.bind(ctx.db);
  ctx.db.query = ((table: TableNames) => {
    const query = queryTable(table);
    if (table === "runtimeDevicePresences") query.unique = async () => {
      const matching = await query.collect();
      if (matching.length > 1) throw new Error("Expected a unique device/session presence");
      return matching[0] ?? null;
    };
    return query;
  }) as typeof ctx.db.query;
  const presence = rows.runtimeDevicePresences[0];
  const recoveredAt = (presence.expiresAt as number) + 1;
  await expireRuntimePresenceHandler(ctx, {
    runtimeDeviceId: presence.runtimeDeviceId as Id<"runtimeDevices">,
    presenceId: presence._id as Id<"runtimeDevicePresences">,
    presenceSessionId: permissionHost.presenceSessionId,
    expectedExpiresAt: presence.expiresAt as number, now: recoveredAt,
  });
  assert.equal(presence.status, "offline");
  const heartbeat = {
    ...permissionHost, owner: "foreground_cli" as const, connectedAt: now,
    heartbeatAt: recoveredAt, hostVersion: "0.1.0",
    platform: { operatingSystem: "macos" as const, architecture: "arm64" as const, release: "26.0" },
    adapters: presence.adapters as Parameters<typeof heartbeatPresenceHandler>[1]["adapters"],
    now: recoveredAt,
  };
  const recovered = await heartbeatPresenceHandler(ctx, heartbeat);
  assert.equal(recovered.presenceId, presence._id);
  assert.equal(rows.runtimeDevicePresences.length, 1);
  assert.equal(presence.status, "online");
  assert.equal(presence.disconnectedAt, undefined);
  assert.equal(presence.disconnectReason, undefined);
  assert.equal(rows.runtimeDevices[0].currentPresenceId, presence._id);
  const authenticated = await authenticateOnlineRuntimeHost(ctx, permissionHost, recoveredAt);
  assert.equal(authenticated.presence._id, presence._id);
  assert.equal(authenticated.claimantId, `runtime-host:${permissionHost.deviceId}:${permissionHost.presenceSessionId}`);
  const poll = listPending as unknown as { _handler: (ctx: QueryCtx, args: typeof permissionHost) => Promise<unknown[]> };
  assert.deepEqual(await poll._handler(ctx as unknown as QueryCtx, permissionHost), []);
  await assert.rejects(heartbeatPresenceHandler(ctx, {
    ...heartbeat, presenceSessionId: "competing-session", now: recoveredAt + 1,
  }), /already has an active Runtime Host/);
});
