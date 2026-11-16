import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { telegramComponentFakes, telegramFixture } from "../../test_helpers/telegram_fixture";
import { accountAccessState } from "../lib/account_access";
import { requireAuth } from "../lib/auth";
import { isUserDataWritable } from "../lib/write_fence";
import { createExecutionRun } from "../execution/runs";
import { assertCurrentExecution } from "../execution/attempts";
import { authenticateRuntimeHost, sha256Hex } from "../runtime_host/security";
import { completeUpload, getUpload } from "../storage_uploads";
import { triggerJobViaApi } from "../scheduledJobs/mutations";
import { receive } from "../channels/telegram/ingress";
import { admit } from "../channels/telegram/admission";
import { getAccountCancellationState } from "../execution/teardown_queries";
import { invoke } from "./conversation_context_fixture";

type Rows = Record<string, Array<Record<string, unknown>>>;
function blockedState(rows: Rows) {
  rows.accountAccessBlocks = [{ _id: "block", userId: "user_1", reason: "Banned in Clerk", source: "clerk", blockedAt: 1 }];
  const mock = createStatefulMockCtx(rows);
  Object.assign((mock as unknown as MutationCtx).db, { system: {} });
  return { mock, ctx: mock as unknown as MutationCtx };
}
function handler<A, R>(fn: unknown) {
  return (fn as { _handler: (ctx: MutationCtx, args: A) => Promise<R> })._handler;
}

test("the account fence reports deletion before a block and ignores other users' rows", async () => {
  const rows: Rows = { accountDeletionTombstones: [], accountAccessBlocks: [] };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  assert.equal(await accountAccessState(ctx.db, "user_1"), "active");
  rows.accountAccessBlocks.push({ _id: "other", userId: "user_2" });
  assert.equal(await accountAccessState(ctx.db, "user_1"), "active");
  rows.accountAccessBlocks.push({ _id: "mine", userId: "user_1" });
  assert.equal(await accountAccessState(ctx.db, "user_1"), "blocked");
  rows.accountDeletionTombstones.push({ _id: "tomb", userId: "user_1", requestedAt: 1 });
  assert.equal(await accountAccessState(ctx.db, "user_1"), "deleting");
});

test("a blocked account fails requireAuth with ACCOUNT_BLOCKED in queries, mutations and actions", async () => {
  const { ctx } = blockedState({});
  await assert.rejects(requireAuth(ctx), (error: unknown) => {
    const data = (error as { data?: { code?: string } }).data;
    return data?.code === "ACCOUNT_BLOCKED";
  });
  const action = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async (ref: unknown) => {
      assert.equal(getFunctionName(ref as never), "account/deletion_state:getAccountAccessState");
      return "blocked";
    },
  } as unknown as ActionCtx;
  await assert.rejects(requireAuth(action), /ACCOUNT_BLOCKED/);
});

test("background writers, execution creation and the attempt fence stop for a blocked owner", async () => {
  const { ctx } = blockedState({
    chats: [{ _id: "chat", userId: "user_1" }],
    executionRuns: [{ _id: "run", userId: "user_1", activeAttemptId: "attempt", state: "running" }],
    executionAttempts: [{ _id: "attempt", runId: "run", fence: 3, status: "running" }],
  });
  assert.equal(await isUserDataWritable(ctx, "user_1", "chat" as Id<"chats">), false);
  await assert.rejects(createExecutionRun(ctx, {
    userId: "user_1", initialAttempt: { executorKind: "convex_workflow" },
  } as never), /ACCOUNT_BLOCKED/);
  await assert.rejects(assertCurrentExecution(ctx, {
    attemptId: "attempt" as Id<"executionAttempts">, fence: 3,
  }), /EXECUTION_OWNER_BLOCKED/);
  // Cancellation must still be able to terminalize the blocked owner's work.
  await assertCurrentExecution(ctx, { attemptId: "attempt" as Id<"executionAttempts">, fence: 3, allowDeletingOwner: true });
});

test("Runtime Host credentials, storage uploads and API triggers stop for a blocked owner", async () => {
  const credential = "nrh_test-credential";
  const { ctx } = blockedState({
    runtimeDeviceCredentials: [{ _id: "cred", credentialId: "cred-1", deviceId: "dev-1", runtimeDeviceId: "device", status: "active", credentialHash: await sha256Hex(credential) }],
    runtimeDevices: [{ _id: "device", deviceId: "dev-1", userId: "user_1", status: "active" }],
    clientStorageUploads: [{ _id: "upload", userId: "user_1", tokenHash: "hash", uploadUrl: "https://upload.invalid" }],
    scheduledJobs: [{ _id: "job", userId: "user_1", status: "active" }],
  });
  await assert.rejects(authenticateRuntimeHost(ctx, { deviceId: "dev-1", credentialId: "cred-1", credential }), /UNAUTHORIZED/);
  assert.equal(await handler<{ tokenHash: string }, unknown>(getUpload)(ctx, { tokenHash: "hash" }), null);
  assert.equal(await handler<{ uploadId: string; storageId: string }, boolean>(completeUpload)(ctx, { uploadId: "upload", storageId: "storage" }), false);
  await assert.rejects(handler<Record<string, unknown>, unknown>(triggerJobViaApi)(ctx, { jobId: "job", userId: "user_1", requestId: "req" }), /ACCOUNT_BLOCKED/);
});

test("a linked Telegram identity cannot admit turns for a blocked account", async () => {
  telegramComponentFakes();
  const { ctx, rows } = telegramFixture();
  Object.assign(ctx.db, { system: {} });
  const id = await invoke<Id<"channelInbox">>(receive, ctx, {
    botId: "bot", updateId: 10, externalUserId: "42", externalChatId: "42", externalMessageId: 1, text: "hello", kind: "text", claimantName: "Tester",
  });
  rows.accountAccessBlocks = [{ _id: "block", userId: "user_1", source: "admin", reason: "test", blockedAt: 1 }];
  await assert.rejects(invoke(admit, ctx, { inboxId: id, claimantName: "Tester" }), /USER_DATA_NOT_WRITABLE/);
  assert.equal((rows.messages ?? []).length, 0);
});

test("the account-wide cancellation sweep runs behind a block as well as a tombstone", async () => {
  const { ctx } = blockedState({ accountDeletionTombstones: [] });
  const state = await handler<{ userId: string }, { cancellationCursor?: string } | null>(getAccountCancellationState)(ctx, { userId: "user_1" });
  assert.deepEqual(state, { cancellationCursor: undefined });
  assert.equal(await handler<{ userId: string }, unknown>(getAccountCancellationState)(ctx, { userId: "user_2" }), null);
});
