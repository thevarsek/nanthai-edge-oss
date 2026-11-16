import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { blockUser, continueAccountRevocation, unblockUser } from "../security/account_access_blocks";

type Rows = Record<string, Array<Record<string, unknown>>>;
function handler<A, R>(fn: unknown) {
  return (fn as { _handler: (ctx: MutationCtx, args: A) => Promise<R> })._handler;
}
function credentialRows(): Rows {
  return {
    accountAccessBlocks: [],
    externalMcpGrants: [{ _id: "grant", userId: "user_1" }, { _id: "other-grant", userId: "user_2" }],
    externalMcpAuthorizations: [{ _id: "pending", userId: "user_1" }],
    runtimeDevices: [{ _id: "device", userId: "user_1", deviceId: "dev-1", status: "active" }],
    runtimeDeviceCredentials: [{ _id: "cred", runtimeDeviceId: "device", status: "active" }],
    runtimePairingRequests: [{ _id: "pairing", userId: "user_1", status: "pending" }],
    scheduledJobTriggerTokens: [{ _id: "trigger", userId: "user_1", status: "active" }],
    scheduledJobs: [{ _id: "job", userId: "user_1", status: "active", scheduledFunctionId: "fn", nextRunAt: 5 }],
    channelIdentities: [{ _id: "identity", userId: "user_1", active: true, revision: 1 }],
    channelLinkGrants: [{ _id: "link", userId: "user_1", status: "pending" }],
    deviceTokens: [{ _id: "push", userId: "user_1", token: "apns" }],
  };
}
function state(rows: Rows) {
  const cancelled: string[] = [];
  const mock = createStatefulMockCtx(rows);
  Object.assign(mock.scheduler, { cancel: async (id: string) => { cancelled.push(id); } });
  return { mock, cancelled, ctx: mock as unknown as MutationCtx };
}

test("blockUser fences the account and revokes every credential NanthAI issued to it", async () => {
  const rows = credentialRows();
  const { ctx, mock, cancelled } = state(rows);
  const result = await handler<Record<string, unknown>, { created: boolean; source: string }>(blockUser)(ctx, { userId: "user_1", reason: "Abuse" });
  assert.equal(result.created, true);
  assert.equal(result.source, "admin");
  assert.equal(rows.accountAccessBlocks.length, 1);
  assert.equal(typeof rows.externalMcpGrants[0].revokedAt, "number");
  assert.equal(rows.externalMcpGrants[1].revokedAt, undefined, "other accounts are untouched");
  assert.equal(typeof rows.externalMcpAuthorizations[0].consumedAt, "number");
  assert.equal(rows.runtimeDevices[0].status, "revoked");
  assert.equal(rows.runtimeDeviceCredentials[0].status, "revoked");
  assert.equal(rows.runtimePairingRequests[0].status, "cancelled");
  assert.equal(rows.scheduledJobTriggerTokens[0].status, "revoked");
  assert.equal(rows.scheduledJobs[0].status, "paused");
  assert.equal(rows.scheduledJobs[0].scheduledFunctionId, undefined);
  assert.deepEqual(cancelled, ["fn"]);
  assert.equal(rows.channelIdentities[0].active, false);
  assert.equal(rows.channelLinkGrants[0].status, "revoked");
  assert.equal(rows.deviceTokens.length, 0);
  assert.ok(mock.scheduled.some(payload => payload.reason === "Account blocked" && payload.userId === "user_1"),
    "active runs go through the centralized account teardown");
});

test("blockUser paginates large credential sets and stops continuing after an unblock", async () => {
  const rows: Rows = {
    accountAccessBlocks: [],
    scheduledJobTriggerTokens: Array.from({ length: 60 }, (_, index) => ({ _id: `token-${index}`, userId: "user_1", status: "active" })),
  };
  const { ctx, mock } = state(rows);
  await handler<Record<string, unknown>, unknown>(blockUser)(ctx, { userId: "user_1", reason: "Abuse" });
  assert.ok(mock.scheduled.some(payload => Object.keys(payload).length === 1 && payload.userId === "user_1"), "a follow-up page is scheduled");
  await handler<{ userId: string }, null>(continueAccountRevocation)(ctx, { userId: "user_1" });
  assert.ok(rows.scheduledJobTriggerTokens.every(token => token.status === "revoked"));
  await handler<Record<string, unknown>, unknown>(unblockUser)(ctx, { userId: "user_1" });
  rows.scheduledJobTriggerTokens.push({ _id: "late", userId: "user_1", status: "active" });
  await handler<{ userId: string }, null>(continueAccountRevocation)(ctx, { userId: "user_1" });
  assert.equal(rows.scheduledJobTriggerTokens.at(-1)?.status, "active", "an unblocked account is not revoked further");
});

test("an admin block outranks the identity provider and unblocking keeps revoked credentials revoked", async () => {
  const rows = credentialRows();
  const { ctx } = state(rows);
  const block = handler<Record<string, unknown>, { created: boolean; source: string }>(blockUser);
  const unblock = handler<Record<string, unknown>, { removed: boolean }>(unblockUser);
  await block(ctx, { userId: "user_1", reason: "Banned in Clerk", source: "clerk" });
  const escalated = await block(ctx, { userId: "user_1", reason: "Manual review", source: "admin" });
  assert.equal(escalated.created, false);
  assert.equal(escalated.source, "admin");
  assert.equal((await block(ctx, { userId: "user_1", reason: "Banned again", source: "clerk" })).source, "admin");
  assert.equal(rows.accountAccessBlocks.length, 1);
  assert.deepEqual(await unblock(ctx, { userId: "user_1", source: "clerk" }), { removed: false });
  assert.deepEqual(await unblock(ctx, { userId: "user_1" }), { removed: true });
  assert.equal(rows.accountAccessBlocks.length, 0);
  assert.equal(rows.runtimeDevices[0].status, "revoked");
  assert.equal(typeof rows.externalMcpGrants[0].revokedAt, "number");
  assert.equal(rows.scheduledJobs[0].status, "paused");
});
