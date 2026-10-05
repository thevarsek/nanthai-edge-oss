import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { authenticateGrant, pkceChallenge, validRedirect } from "../external_mcp/policy";
import { registerClient, begin, consent, exchange, revoke } from "../external_mcp/oauth";
import { discover, replayReceipt, write } from "../external_mcp/dispatch";
import { convexToJson } from "convex/values";
import { toolsForScopes } from "../external_mcp/tools";
import { sha256Hex } from "../runtime_host/security";

function handler<A, R>(fn: unknown) { return (fn as { _handler: (ctx: MutationCtx, args: A) => Promise<R> })._handler; }
test("OAuth consent, PKCE, single-use codes, refresh scopes and revocation use hashed account grants", async () => {
  const previous = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://dev.convex.site";
  try {
    const rows: Record<string, Array<Record<string, unknown>>> = { externalMcpClients: [], externalMcpAuthorizations: [], externalMcpGrants: [], accountDeletionTombstones: [] };
    const state = createStatefulMockCtx(rows);
    const ctx = state as unknown as MutationCtx;
    Object.assign(ctx.db, { system: {} });
    const client = await handler<{ name: string; redirectUris: string[] }, { client_id: string }>(registerClient)(ctx, { name: "QA client", redirectUris: ["http://127.0.0.1:7777/callback"] });
    const verifier = "a".repeat(43);
    const request = await handler<Record<string, string>, string>(begin)(ctx, { clientId: client.client_id, redirectUri: "http://127.0.0.1:7777/callback", resource: "https://dev.convex.site/mcp", challenge: await pkceChallenge(verifier), scope: "history:read chat:write", state: "test-state" });
    const approve = handler<{ request: string; scopes: string[]; allow: boolean }, string>(consent);
    await assert.rejects(approve(ctx, { request, scopes: ["runs:stop"], allow: true }), /invalid_scope/);
    const redirect = new URL(await approve(ctx, { request, scopes: ["history:read"], allow: true }));
    assert.equal(redirect.searchParams.get("state"), "test-state");
    const code = redirect.searchParams.get("code") ?? "";
    const exchangeCode = handler<Record<string, string>, { access_token: string; refresh_token?: string; expires_in: number; scope: string }>(exchange);
    const args = { grantType: "authorization_code", clientId: client.client_id, code, verifier, redirectUri: "http://127.0.0.1:7777/callback", resource: "https://dev.convex.site/mcp" };
    await assert.rejects(exchangeCode(ctx, { ...args, verifier: "b".repeat(43) }), /invalid_grant/);
    const tokens = await exchangeCode(ctx, args);
    assert.equal(tokens.expires_in, 3600);
    assert.equal(tokens.scope, "history:read");
    assert.ok(!JSON.stringify(rows).includes(tokens.access_token));
    assert.ok(!JSON.stringify(rows).includes(tokens.refresh_token ?? "missing"));
    await assert.rejects(exchangeCode(ctx, args), /invalid_grant/);
    await authenticateGrant(ctx, tokens.access_token, "history:read");
    const discovery = await handler<{ accessToken: string }, string>(discover)(ctx, { accessToken: tokens.access_token });
    assert.equal(convexToJson(discovery), discovery);
    assert.deepEqual(JSON.parse(discovery), toolsForScopes(["history:read"]));
    await assert.rejects(authenticateGrant(ctx, tokens.access_token, "chat:write"), /insufficient_scope/);
    const refreshed = await exchangeCode(ctx, { grantType: "refresh_token", clientId: client.client_id, refreshToken: tokens.refresh_token ?? "", scope: "" });
    await assert.rejects(authenticateGrant(ctx, refreshed.access_token, "history:read"), /insufficient_scope/);
    await assert.rejects(authenticateGrant(ctx, tokens.access_token), /invalid_token/);
    await handler<{ grantId: string }, null>(revoke)(ctx, { grantId: String(rows.externalMcpGrants[0]._id) });
    await assert.rejects(authenticateGrant(ctx, refreshed.access_token), /invalid_token/);
    await assert.rejects(exchangeCode(ctx, { grantType: "refresh_token", clientId: client.client_id, refreshToken: tokens.refresh_token ?? "" }), /invalid_grant/);
  } finally { if (previous === undefined) delete process.env.CONVEX_SITE_URL; else process.env.CONVEX_SITE_URL = previous; }
});

test("publication joins the selected chat branch and replay does not duplicate history, files or usage", async () => {
  const previous = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://dev.convex.site";
  try {
    const rows: Record<string, Array<Record<string, unknown>>> = {
      externalMcpGrants: [{ _id: "grant", userId: "user_1", clientId: "client", name: "QA", resource: "https://dev.convex.site/mcp", scopes: ["results:write"], accessScopes: ["results:write"], accessHash: await sha256Hex("test-access"), accessExpiresAt: Date.now() + 3600000 }],
      externalMcpReceipts: [], accountDeletionTombstones: [], generatedFiles: [], usageRecords: [],
      chats: [{ _id: "chat", userId: "user_1", activeBranchLeafId: "selected-leaf" }],
      messages: [{ _id: "selected-leaf", chatId: "chat", role: "assistant", content: "Selected branch" }, { _id: "another-leaf", chatId: "chat", role: "assistant", content: "Other branch" }],
    };
    const state = createStatefulMockCtx(rows);
    const ctx = state as unknown as MutationCtx;
    Object.assign(ctx.db, { system: {}, normalizeId: (_table: string, value: string) => value });
    Object.assign(ctx.storage, { getMetadata: async () => ({ size: 6 }) });
    const invoke = handler<{ accessToken: string; tool: string; inputJson: string; storageId: string }, string>(write);
    const args = { accessToken: "test-access", tool: "nanthai_publish_result", storageId: "storage", inputJson: JSON.stringify({ callId: "publish-once", chatId: "chat", content: "Report", filename: "report.md", mimeType: "text/markdown" }) };
    const receipt = await invoke(ctx, args);
    const published = rows.messages.at(-1);
    assert.deepEqual(published?.parentMessageIds, ["selected-leaf"]);
    assert.equal(rows.chats[0].activeBranchLeafId, published?._id);
    assert.equal(await invoke(ctx, { ...args, storageId: "replay-storage" }), receipt);
    assert.equal(rows.messages.length, 3);
    assert.equal(rows.generatedFiles.length, 1);
    assert.equal(rows.usageRecords.length, 0);
    assert.deepEqual(state.storageDeletes, ["replay-storage"]);
  } finally { if (previous === undefined) delete process.env.CONVEX_SITE_URL; else process.env.CONVEX_SITE_URL = previous; }
});

test("external tools expose only granted operations and reject changed retry arguments", () => {
  assert.deepEqual(toolsForScopes(["runs:stop"]).map(tool => tool.name), ["nanthai_stop_run"]);
  assert.equal(toolsForScopes([]).length, 0);
  assert.equal(replayReceipt({ tool: "nanthai_run_job", inputHash: "same", resultJson: "receipt" }, "nanthai_run_job", "same"), "receipt");
  assert.throws(() => replayReceipt({ tool: "nanthai_run_job", inputHash: "old", resultJson: "receipt" }, "nanthai_run_job", "changed"), /different arguments/);
  assert.equal(validRedirect("https://user:password@example.com/callback"), false);
  assert.equal(validRedirect("file:///tmp/callback"), false);
  assert.equal(validRedirect("http://127.0.0.1:7777/callback"), true);
});

test("accepted Run Now is atomic with its receipt, foreign IDs and account deletion are rejected", async () => {
  const previous = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = "https://dev.convex.site";
  try {
    const { sha256Hex } = await import("../runtime_host/security");
    const rows: Record<string, Array<Record<string, unknown>>> = {
      externalMcpGrants: [{ _id: "grant", userId: "user_1", clientId: "client", name: "QA", resource: "https://dev.convex.site/mcp", scopes: ["jobs:run"], accessScopes: ["jobs:run"], accessHash: await sha256Hex("test-access"), accessExpiresAt: Date.now() + 3600000 }],
      externalMcpReceipts: [], accountDeletionTombstones: [], purchaseEntitlements: [{ _id: "pro", userId: "user_1", status: "active", productId: "tech.nanthai.edge.pro.monthly" }],
      scheduledJobs: [{ _id: "job", userId: "user_1", status: "active", recurrence: { type: "manual" } }, { _id: "foreign", userId: "another", status: "active", recurrence: { type: "manual" } }],
    };
    const state = createStatefulMockCtx(rows);
    const ctx = state as unknown as MutationCtx;
    Object.assign(ctx.db, { system: {}, normalizeId: (_table: string, value: string) => value });
    const invoke = handler<{ accessToken: string; tool: string; inputJson: string }, string>(write);
    const args = { accessToken: "test-access", tool: "nanthai_run_job", inputJson: '{"callId":"once","jobId":"job"}' };
    const receipt = await invoke(ctx, args);
    assert.equal(await invoke(ctx, args), receipt);
    assert.equal(state.scheduled.length, 1);
    assert.equal(rows.externalMcpReceipts.length, 1);
    await assert.rejects(invoke(ctx, { ...args, inputJson: '{"callId":"foreign-call","jobId":"foreign"}' }), /unauthorized/);
    rows.accountDeletionTombstones.push({ userId: "user_1", requestedAt: Date.now() });
    await assert.rejects(invoke(ctx, args), /deletion is in progress/);
  } finally { if (previous === undefined) delete process.env.CONVEX_SITE_URL; else process.env.CONVEX_SITE_URL = previous; }
});
