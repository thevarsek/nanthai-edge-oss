import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import { getFunctionName } from "convex/server";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { verifySvixSignature } from "../account/svix_signature";
import { clerkWebhookHttp, parseClerkWebhookEvent } from "../account/clerk_webhook";
import { applyClerkWebhookEvent, pruneWebhookDeliveries } from "../account/clerk_webhook_events";

const secretBytes = randomBytes(24);
const secret = ["whsec", secretBytes.toString("base64")].join("_");
function sign(id: string, timestamp: string, body: string, key: Buffer = secretBytes): string {
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}
function nowSeconds(): string { return String(Math.floor(Date.now() / 1000)); }
function handler<A, R>(fn: unknown) {
  return (fn as { _handler: (ctx: MutationCtx, args: A) => Promise<R> })._handler;
}

test("Svix signatures verify with the decoded secret, any v1 entry, and a five-minute window", async () => {
  const body = JSON.stringify({ type: "user.updated", data: { id: "user_1", banned: true } });
  const timestamp = nowSeconds();
  const base = { secret, id: "msg_1", timestamp, body, nowMs: Date.now() };
  assert.deepEqual(await verifySvixSignature({ ...base, signatureHeader: sign("msg_1", timestamp, body) }), { ok: true });
  const rotated = `v1,${randomBytes(32).toString("base64")} ${sign("msg_1", timestamp, body)}`;
  assert.deepEqual(await verifySvixSignature({ ...base, signatureHeader: rotated }), { ok: true });
  assert.deepEqual(await verifySvixSignature({ ...base, signatureHeader: sign("msg_1", timestamp, body, randomBytes(24)) }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await verifySvixSignature({ ...base, signatureHeader: sign("msg_1", timestamp, `${body} `) }), { ok: false, reason: "bad_signature" });
  assert.deepEqual(await verifySvixSignature({ ...base, signatureHeader: sign("msg_1", timestamp, body).replace("v1,", "v2,") }), { ok: false, reason: "bad_signature" });
  const old = String(Number(timestamp) - 301);
  assert.deepEqual(await verifySvixSignature({ ...base, timestamp: old, signatureHeader: sign("msg_1", old, body) }), { ok: false, reason: "stale_timestamp" });
  const future = String(Number(timestamp) + 301);
  assert.deepEqual(await verifySvixSignature({ ...base, timestamp: future, signatureHeader: sign("msg_1", future, body) }), { ok: false, reason: "stale_timestamp" });
  assert.deepEqual(await verifySvixSignature({ ...base, signatureHeader: null }), { ok: false, reason: "missing_headers" });
  assert.deepEqual(await verifySvixSignature({ ...base, secret: undefined, signatureHeader: sign("msg_1", timestamp, body) }), { ok: false, reason: "missing_secret" });
});

test("the webhook route verifies before applying and returns 2xx for ignored events", async () => {
  const previous = process.env.CLERK_WEBHOOK_SECRET;
  process.env.CLERK_WEBHOOK_SECRET = secret;
  const calls: Array<Record<string, unknown>> = [];
  const ctx = { runMutation: async (ref: unknown, args: Record<string, unknown>) => {
    assert.equal(getFunctionName(ref as never), "account/clerk_webhook_events:applyClerkWebhookEvent");
    calls.push(args);
    return args.eventType === "session.created" ? "ignored" : "blocked";
  } } as unknown as ActionCtx;
  const request = (body: string, headers: Record<string, string>) => new Request("https://dev.example/clerk/webhook", { method: "POST", headers, body });
  try {
    const body = JSON.stringify({ type: "user.updated", data: { id: "user_1", banned: true, locked: false } });
    const timestamp = nowSeconds();
    const valid = { "svix-id": "msg_1", "svix-timestamp": timestamp, "svix-signature": sign("msg_1", timestamp, body) };
    assert.equal((await clerkWebhookHttp(ctx, request(body, { ...valid, "svix-signature": sign("msg_1", timestamp, body, randomBytes(24)) }))).status, 401);
    const old = String(Number(timestamp) - 600);
    assert.equal((await clerkWebhookHttp(ctx, request(body, { ...valid, "svix-timestamp": old, "svix-signature": sign("msg_1", old, body) }))).status, 401);
    assert.equal(calls.length, 0, "unverified deliveries never reach the database");
    const accepted = await clerkWebhookHttp(ctx, request(body, valid));
    assert.equal(accepted.status, 200);
    assert.deepEqual(calls[0], { deliveryId: "msg_1", eventType: "user.updated", userId: "user_1", banned: true, locked: false });
    const ignoredBody = JSON.stringify({ type: "session.created", data: { id: "sess_1" } });
    const ignored = await clerkWebhookHttp(ctx, request(ignoredBody, { "svix-id": "msg_2", "svix-timestamp": timestamp, "svix-signature": sign("msg_2", timestamp, ignoredBody) }));
    assert.equal(ignored.status, 200);
    assert.equal(await ignored.text(), "ignored");
    delete process.env.CLERK_WEBHOOK_SECRET;
    assert.equal((await clerkWebhookHttp(ctx, request(body, valid))).status, 503);
  } finally {
    if (previous === undefined) delete process.env.CLERK_WEBHOOK_SECRET; else process.env.CLERK_WEBHOOK_SECRET = previous;
  }
});

test("Clerk events are parsed narrowly", () => {
  assert.deepEqual(parseClerkWebhookEvent({ type: "user.deleted", data: { id: "user_1", deleted: true } }), { kind: "user.deleted", userId: "user_1" });
  assert.deepEqual(parseClerkWebhookEvent({ type: "user.updated", data: { id: "user_1", locked: true } }), { kind: "user.updated", userId: "user_1", banned: false, locked: true });
  assert.deepEqual(parseClerkWebhookEvent({ type: "email.created", data: {} }), { kind: "ignored", eventType: "email.created" });
  assert.equal(parseClerkWebhookEvent({ type: "user.updated", data: {} }), null);
  assert.equal(parseClerkWebhookEvent(null), null);
});

test("ban, replay, unban and deletion events drive the shared account paths", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = { identityWebhookDeliveries: [], accountAccessBlocks: [], accountDeletionTombstones: [] };
  const mock = createStatefulMockCtx(rows);
  const ctx = mock as unknown as MutationCtx;
  const apply = handler<Record<string, unknown>, string>(applyClerkWebhookEvent);
  assert.equal(await apply(ctx, { deliveryId: "msg_1", eventType: "user.updated", userId: "user_1", banned: true, locked: false }), "blocked");
  assert.equal(rows.accountAccessBlocks[0].source, "clerk");
  assert.equal(await apply(ctx, { deliveryId: "msg_1", eventType: "user.updated", userId: "user_1", banned: false, locked: false }), "duplicate");
  assert.equal(rows.accountAccessBlocks.length, 1, "a replayed delivery has no effect");
  assert.equal(await apply(ctx, { deliveryId: "msg_2", eventType: "user.updated", userId: "user_1", banned: false, locked: false }), "unblocked");
  assert.equal(rows.accountAccessBlocks.length, 0);
  assert.equal(await apply(ctx, { deliveryId: "msg_3", eventType: "user.updated", userId: "user_1", banned: false, locked: false }), "ignored");
  assert.equal(await apply(ctx, { deliveryId: "msg_4", eventType: "user.deleted", userId: "user_1" }), "deleting");
  assert.equal(rows.accountDeletionTombstones[0].userId, "user_1");
  assert.deepEqual(mock.scheduled.at(-1), { userId: "user_1", attempt: 0 });
  rows.identityWebhookDeliveries[0].receivedAt = Date.now() - 25 * 60 * 60_000;
  assert.equal(await handler<Record<string, never>, number>(pruneWebhookDeliveries)(ctx, {}), 1);
  assert.equal(rows.identityWebhookDeliveries.length, 3);
});
