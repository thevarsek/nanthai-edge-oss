import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { assertOwnedStorage, createOwnedUploadUrl } from "../lib/storage_ownership";
import { bindChatUploadSessionHandler, cleanupChatUploadSessionHandler, cleanupExpiredChatUploadSessionsHandler } from "../chat/upload_handlers";
import { bindKnowledgeBaseUploadSession, cleanupUnclaimedUpload } from "../knowledge_base/mutations";
import { claimUpload, completeUpload, releaseUpload, UPLOAD_TOKEN_TTL_MS, uploadStorageHttp } from "../storage_uploads";
import { sha256Hex } from "../scheduledJobs/trigger_auth";
import { persistBrowserSnapshotHandler } from "../presentations/snapshot_persistence";

type Rows = Record<string, Array<Record<string, unknown>>>;
function state(rows: Rows) {
  const mock = createStatefulMockCtx(rows);
  Object.assign((mock as unknown as MutationCtx).db, { system: { get: async () => ({ size: 4 }) } });
  Object.assign(mock.storage, { getMetadata: async () => ({ size: 4 }), generateUploadUrl: async () => "https://native-upload.invalid" });
  return { mock, ctx: mock as unknown as MutationCtx };
}
function handler<A, R>(fn: unknown) {
  return (fn as { _handler: (ctx: MutationCtx, args: A) => Promise<R> })._handler;
}
const storageId = "victim-storage" as Id<"_storage">;
const chatId = "chat-upload" as Id<"chatUploadSessions">;

test("raw foreign IDs cannot be bound or deleted through chat or KB upload sessions", async () => {
  const rows: Rows = {
    chatUploadSessions: [{ _id: chatId, userId: "user_1", status: "pending" }],
    kbUploadSessions: [{ _id: "kb-upload", userId: "user_1", status: "pending" }],
    clientStorageUploads: [{ userId: "victim", storageId }],
    generatedFiles: [{ userId: "victim", storageId }],
  };
  const { mock, ctx } = state(rows);
  await assert.rejects(bindChatUploadSessionHandler(ctx, { uploadSessionId: chatId, storageId }), /not owned/);
  await assert.rejects(handler(bindKnowledgeBaseUploadSession)(ctx, { uploadSessionId: "kb-upload", storageId }), /not owned/);
  await cleanupChatUploadSessionHandler(ctx, { uploadSessionId: chatId, storageId });
  await handler(cleanupUnclaimedUpload)(ctx, { uploadSessionId: "kb-upload", storageId });
  assert.deepEqual(mock.storageDeletes, []);
  assert.equal(rows.chatUploadSessions[0].storageId, undefined);
  assert.equal(rows.kbUploadSessions[0].storageId, undefined);
});

test("client-bound legacy foreign IDs cannot reach explicit or expired cleanup", async () => {
  const rows: Rows = {
    chatUploadSessions: [{ _id: chatId, userId: "user_1", storageId, status: "pending", createdAt: 0 }],
    kbUploadSessions: [{ _id: "kb-upload", userId: "user_1", storageId, status: "pending" }],
    clientStorageUploads: [{ userId: "victim", storageId }],
  };
  const { mock, ctx } = state(rows);
  const originalQuery = ctx.db.query.bind(ctx.db);
  Object.assign(ctx.db, { query: (table: Parameters<typeof ctx.db.query>[0]) => {
    const query = originalQuery(table);
    if (table === "chatUploadSessions") Object.assign(query, { withIndex: () => ({ take: async () => rows.chatUploadSessions }) });
    return query;
  } });
  await cleanupExpiredChatUploadSessionsHandler(ctx);
  rows.chatUploadSessions[0].status = "pending";
  await cleanupChatUploadSessionHandler(ctx, { uploadSessionId: chatId });
  await handler(cleanupUnclaimedUpload)(ctx, { uploadSessionId: "kb-upload", storageId });
  assert.deepEqual(mock.storageDeletes, []);
});

test("owned upload receipts allow ordinary bind and unreferenced cleanup", async () => {
  const rows: Rows = {
    chatUploadSessions: [{ _id: chatId, userId: "user_1", status: "pending" }],
    clientStorageUploads: [{ userId: "user_1", storageId }],
  };
  const { mock, ctx } = state(rows);
  await bindChatUploadSessionHandler(ctx, { uploadSessionId: chatId, storageId });
  await cleanupChatUploadSessionHandler(ctx, { uploadSessionId: chatId, storageId });
  assert.deepEqual(mock.storageDeletes, [storageId]);
  assert.equal(rows.chatUploadSessions[0].status, "cancelled");
});

test("durable owned files remain readable and a conflicting receipt overrides forged references", async () => {
  const rows: Rows = { generatedFiles: [{ userId: "user_1", storageId }] };
  const { ctx } = state(rows);
  await assertOwnedStorage(ctx, "user_1", storageId);
  rows.clientStorageUploads = [{ userId: "victim", storageId }];
  await assert.rejects(assertOwnedStorage(ctx, "user_1", storageId), /not owned/);
});

type Claim = { status: string; uploadId?: string; uploadUrl?: string };
function uploadAction(ctx: MutationCtx, deleted: string[] = []) {
  const claim = handler<{ tokenHash: string; declaredBytes?: number }, Claim>(claimUpload);
  const release = handler<{ uploadId: string }, null>(releaseUpload);
  const complete = handler<{ uploadId: string; storageId: string }, string>(completeUpload);
  return {
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
      const name = getFunctionName(ref);
      if (name === "storage_uploads:claimUpload") return claim(ctx, args as { tokenHash: string });
      if (name === "storage_uploads:releaseUpload") return release(ctx, args as { uploadId: string });
      return complete(ctx, args as { uploadId: string; storageId: string });
    },
    storage: { delete: async (id: string) => { deleted.push(id); } },
  } as unknown as ActionCtx;
}

async function withUploadEnvironment(run: () => Promise<void>) {
  const previous = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://dev.convex.site";
  const originalFetch = globalThis.fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.CONVEX_SITE_URL; else process.env.CONVEX_SITE_URL = previous;
  }
}

test("upload capabilities record the uploader before exposing a storage ID, without buffering the body", async () => {
  await withUploadEnvironment(async () => {
    const rows: Rows = { clientStorageUploads: [] };
    const { ctx } = state(rows);
    const url = await createOwnedUploadUrl(ctx, "user_1");
    const token = new URL(url).searchParams.get("token") ?? "";
    assert.notEqual(rows.clientStorageUploads[0].tokenHash, token);
    assert.equal(rows.clientStorageUploads[0].sweepEligible, true);
    globalThis.fetch = async (input, init) => {
      assert.equal(input, "https://native-upload.invalid");
      assert.ok(init?.body instanceof ReadableStream);
      assert.equal(await new Response(init.body).text(), "body");
      return Response.json({ storageId });
    };
    const response = await uploadStorageHttp(uploadAction(ctx), new Request(url, { method: "POST", body: "body" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { storageId });
    await assertOwnedStorage(ctx, "user_1", storageId);
    await assert.rejects(assertOwnedStorage(ctx, "victim", storageId), /not owned/);
    assert.deepEqual(rows.userDailyUsage.map((row) => [row.kind, row.amount]), [["upload_bytes", 4]]);
    const claim = handler<{ tokenHash: string }, Claim>(claimUpload);
    assert.equal((await claim(ctx, { tokenHash: await sha256Hex("wrong") })).status, "unauthorized");
  });
});

test("an upload token streams one body: replays are rejected and failed attempts can retry", async () => {
  await withUploadEnvironment(async () => {
    const rows: Rows = { clientStorageUploads: [] };
    const { ctx } = state(rows);
    const url = await createOwnedUploadUrl(ctx, "user_1");
    let attempts = 0;
    globalThis.fetch = async () => {
      attempts += 1;
      return attempts === 1 ? new Response(null, { status: 500 }) : Response.json({ storageId });
    };
    const action = uploadAction(ctx);
    assert.equal((await uploadStorageHttp(action, new Request(url, { method: "POST", body: "x" }))).status, 500);
    assert.equal((await uploadStorageHttp(action, new Request(url, { method: "POST", body: "x" }))).status, 200);
    assert.equal((await uploadStorageHttp(action, new Request(url, { method: "POST", body: "x" }))).status, 401);
    assert.equal(attempts, 2);

    // A concurrent second request with an in-flight token is refused too.
    const fresh = state({ clientStorageUploads: [] }).ctx;
    const second = await createOwnedUploadUrl(fresh, "user_1");
    const claim = handler<{ tokenHash: string }, Claim>(claimUpload);
    const tokenHash = await sha256Hex(new URL(second).searchParams.get("token") ?? "");
    assert.equal((await claim(fresh, { tokenHash })).status, "claimed");
    assert.equal((await claim(fresh, { tokenHash })).status, "unauthorized");
  });
});

test("expired, deleted-account and over-quota upload tokens are refused", async () => {
  await withUploadEnvironment(async () => {
    const rows: Rows = { clientStorageUploads: [] };
    const { ctx } = state(rows);
    const claim = handler<{ tokenHash: string; declaredBytes?: number }, Claim>(claimUpload);
    const tokenHashFor = async (url: string) => sha256Hex(new URL(url).searchParams.get("token") ?? "");

    const expired = await tokenHashFor(await createOwnedUploadUrl(ctx, "user_1"));
    rows.clientStorageUploads[0].createdAt = Date.now() - UPLOAD_TOKEN_TTL_MS - 1;
    assert.equal((await claim(ctx, { tokenHash: expired })).status, "unauthorized");

    const big = await tokenHashFor(await createOwnedUploadUrl(ctx, "user_1"));
    assert.equal((await claim(ctx, { tokenHash: big, declaredBytes: 2 * 1024 * 1024 * 1024 })).status, "quota");
    rows.userDailyUsage = [{ _id: "usage", userId: "user_1", kind: "upload_bytes", day: new Date().toISOString().slice(0, 10), amount: 1024 * 1024 * 1024 }];
    assert.equal((await claim(ctx, { tokenHash: big })).status, "quota");

    rows.userDailyUsage = [];
    rows.accountDeletionTombstones = [{ userId: "user_1", requestedAt: Date.now() }];
    assert.equal((await claim(ctx, { tokenHash: big })).status, "unauthorized");
  });
});

test("an upload that would pass the daily byte cap is deleted instead of recorded", async () => {
  await withUploadEnvironment(async () => {
    const rows: Rows = { clientStorageUploads: [] };
    const { ctx } = state(rows);
    Object.assign(ctx.db, { system: { get: async () => ({ size: 600 * 1024 * 1024 }) } });
    rows.userDailyUsage = [{ _id: "usage", userId: "user_1", kind: "upload_bytes", day: new Date().toISOString().slice(0, 10), amount: 500 * 1024 * 1024 }];
    const url = await createOwnedUploadUrl(ctx, "user_1");
    globalThis.fetch = async () => Response.json({ storageId });
    const deleted: string[] = [];
    const response = await uploadStorageHttp(uploadAction(ctx, deleted), new Request(url, { method: "POST", body: "x" }));
    assert.equal(response.status, 413);
    assert.deepEqual(deleted, [storageId]);
    assert.equal(rows.clientStorageUploads.some((row) => row.storageId === storageId), false);
  });
});

test("a foreign snapshot ID is rejected before blob reads, writes or deletion", async () => {
  const events: string[] = [];
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "account/deletion_state:getAccountAccessState") return false;
      if (name === "storage_uploads:assertOwnedUpload") throw new Error("not owned");
      return { _id: "project", userId: "user_1", revision: 1 };
    },
    storage: { get: async () => events.push("get"), delete: async () => events.push("delete") },
    runMutation: async () => events.push("persist"),
  } as unknown as ActionCtx;
  await assert.rejects(persistBrowserSnapshotHandler(ctx, {
    projectId: "project" as Id<"presentationProjects">, expectedRevision: 1, storageId, sizeBytes: 4,
  }), /not owned/);
  assert.deepEqual(events, []);
});
