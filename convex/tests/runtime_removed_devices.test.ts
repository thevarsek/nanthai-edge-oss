import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { hideRemovedDeviceHandler, listMyDevices } from "../runtime_host/devices";

test("list deletion hides only an owned revoked row and retains canonical history", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    runtimeDevices: [
      { _id: "removed", userId: "review", deviceId: "old-mac", status: "revoked", updatedAt: 1 },
      { _id: "active", userId: "review", deviceId: "current-mac", status: "active", updatedAt: 2 },
      { _id: "other", userId: "other-user", status: "revoked" },
    ],
    runtimeDeviceCredentials: [{ _id: "credential", runtimeDeviceId: "removed", status: "revoked" }],
    messages: [{ _id: "answer", content: "Published result", deviceId: "old-mac" }],
    runtimeConversationBindings: [{ _id: "binding", deviceId: "old-mac" }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  const hide = (id: string) => hideRemovedDeviceHandler(ctx, { userId: "review", runtimeDeviceId: id as Id<"runtimeDevices">, now: 10 });
  await assert.rejects(hide("other"), /not found/);
  await assert.rejects(hide("active"), /Remove the pairing/);
  assert.equal(await hide("removed"), true);
  assert.equal(await hide("removed"), false);
  assert.equal(rows.runtimeDevices.length, 3);
  assert.equal(rows.messages[0].content, "Published result");
  assert.equal(rows.runtimeConversationBindings.length, 1);
  assert.equal(rows.runtimeDeviceCredentials.length, 1);
  const list = listMyDevices as unknown as { _handler: (ctx: QueryCtx) => Promise<Array<{ deviceId: string }>> };
  const queryCtx = { db: ctx.db, auth: { getUserIdentity: async () => ({ subject: "review" }) } } as unknown as QueryCtx;
  assert.deepEqual((await list._handler(queryCtx)).map((device) => device.deviceId), ["current-mac"]);
});

test("device choices retain their creation order across heartbeat updates", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { runtimeDevices: [
    { _id: "a", userId: "review", deviceId: "first", status: "active", createdAt: 1, updatedAt: 100 },
    { _id: "b", userId: "review", deviceId: "second", status: "active", createdAt: 2, updatedAt: 90 },
  ] };
  const ctx = createStatefulMockCtx(rows) as unknown as QueryCtx;
  const queryCtx = { db: ctx.db, auth: { getUserIdentity: async () => ({ subject: "review" }) } } as unknown as QueryCtx;
  const list = listMyDevices as unknown as { _handler: (ctx: QueryCtx) => Promise<Array<{ deviceId: string }>> };
  const before = (await list._handler(queryCtx)).map(device => device.deviceId);
  rows.runtimeDevices[0].updatedAt = 80;
  rows.runtimeDevices[1].updatedAt = 110;
  rows.runtimeDevices.reverse();
  assert.deepEqual(before, ["second", "first"]);
  assert.deepEqual((await list._handler(queryCtx)).map(device => device.deviceId), before);
});
