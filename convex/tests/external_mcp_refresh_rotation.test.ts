import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { REFRESH_ABSOLUTE_MS, REFRESH_GRACE_MS, REFRESH_IDLE_MS, authenticateGrant, pkceChallenge } from "../external_mcp/policy";
import { begin, consent, exchange, listMyConnections, registerClient } from "../external_mcp/oauth";
import { oauthHttp } from "../external_mcp/http";
import { pruneExpiredOAuthRows, pruneUnusedClients } from "../external_mcp/cleanup";
import { assertTurnRoutesAllowed, turnAccess } from "../external_mcp/turn_access";
import { sha256Hex } from "../runtime_host/security";

type Rows = Record<string, Array<Record<string, unknown>>>;
type Tokens = { access_token: string; refresh_token: string; scope: string };
type Result = Tokens | { error: string };
const DAY = 24 * 60 * 60_000;
const REDIRECT = "http://127.0.0.1:7777/callback";
const SITE = "https://dev.convex.site";
function handler<A, R>(fn: unknown) { return (fn as { _handler: (ctx: MutationCtx, args: A) => Promise<R> })._handler; }
const run = handler<Record<string, string>, Result>(exchange);
function tokens(result: Result): Tokens { assert.ok(!("error" in result), JSON.stringify(result)); return result as Tokens; }

async function withSite<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env.CONVEX_SITE_URL;
  process.env.CONVEX_SITE_URL = SITE;
  try { return await body(); } finally { if (previous === undefined) delete process.env.CONVEX_SITE_URL; else process.env.CONVEX_SITE_URL = previous; }
}
function oauthState(): { rows: Rows; ctx: MutationCtx } {
  const rows: Rows = { externalMcpClients: [], externalMcpAuthorizations: [], externalMcpGrants: [], externalMcpRefreshHistory: [], accountDeletionTombstones: [], accountAccessBlocks: [] };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  Object.assign(ctx.db, { system: {} });
  return { rows, ctx };
}
async function authorize(ctx: MutationCtx, scopes: string[]) {
  const client = await handler<{ name: string; redirectUris: string[] }, { client_id: string }>(registerClient)(ctx, { name: "QA client", redirectUris: [REDIRECT] });
  const verifier = "v".repeat(43);
  const request = await handler<Record<string, string>, string>(begin)(ctx, { clientId: client.client_id, redirectUri: REDIRECT, resource: `${SITE}/mcp`, challenge: await pkceChallenge(verifier), scope: scopes.join(" ") });
  const redirect = new URL(await handler<{ request: string; scopes: string[]; allow: boolean }, string>(consent)(ctx, { request, scopes, allow: true }));
  const code = { grantType: "authorization_code", clientId: client.client_id, code: redirect.searchParams.get("code") ?? "", verifier, redirectUri: REDIRECT };
  return { clientId: client.client_id, code };
}
const refreshArgs = (clientId: string, refreshToken: string) => ({ grantType: "refresh_token", clientId, refreshToken });

test("refresh rotates, honours a short grace window and revokes the grant on later reuse", () => withSite(async () => {
  const { rows, ctx } = oauthState();
  const { clientId, code } = await authorize(ctx, ["history:read"]);
  const first = tokens(await run(ctx, code));
  const grant = rows.externalMcpGrants[0];
  assert.equal(grant.refreshExpiresAt, (grant.createdAt as number) + REFRESH_ABSOLUTE_MS);
  const second = tokens(await run(ctx, refreshArgs(clientId, first.refresh_token)));
  assert.notEqual(second.refresh_token, first.refresh_token);
  assert.equal(rows.externalMcpRefreshHistory.length, 1);
  assert.ok(!JSON.stringify(rows).includes(second.refresh_token), "only hashes are stored");
  // A retry inside the grace window (lost response) rotates again.
  const retried = tokens(await run(ctx, refreshArgs(clientId, first.refresh_token)));
  await authenticateGrant(ctx, retried.access_token, "history:read");
  for (const retired of rows.externalMcpRefreshHistory) retired.retiredAt = Date.now() - REFRESH_GRACE_MS - 1;
  assert.deepEqual(await run(ctx, refreshArgs(clientId, first.refresh_token)), { error: "invalid_grant" });
  assert.equal(typeof grant.revokedAt, "number", "reuse after the window revokes the whole grant");
  await assert.rejects(authenticateGrant(ctx, retried.access_token), /invalid_token/);
  await assert.rejects(run(ctx, refreshArgs(clientId, retried.refresh_token)), /invalid_grant/);
}));

test("a replayed authorization code revokes the grant it produced", () => withSite(async () => {
  const { rows, ctx } = oauthState();
  const { code } = await authorize(ctx, ["history:read"]);
  const issued = tokens(await run(ctx, code));
  assert.equal(rows.externalMcpAuthorizations[0].grantId, rows.externalMcpGrants[0]._id);
  assert.deepEqual(await run(ctx, code), { error: "invalid_grant" });
  assert.equal(rows.externalMcpGrants.length, 1);
  await assert.rejects(authenticateGrant(ctx, issued.access_token), /invalid_token/);
}));

test("refresh ends at the absolute deadline, after 30 idle days, and for legacy grants without a deadline", () => withSite(async () => {
  const cases: Array<[string, (grant: Record<string, unknown>) => void]> = [
    ["absolute", grant => { grant.refreshExpiresAt = Date.now() - 1; }],
    ["idle", grant => { grant.lastUsedAt = Date.now() - REFRESH_IDLE_MS - 1; }],
    ["legacy", grant => { delete grant.refreshExpiresAt; delete grant.lastUsedAt; grant.createdAt = Date.now() - REFRESH_ABSOLUTE_MS - DAY; }],
  ];
  for (const [label, age] of cases) {
    const { rows, ctx } = oauthState();
    const { clientId, code } = await authorize(ctx, ["history:read"]);
    const issued = tokens(await run(ctx, code));
    age(rows.externalMcpGrants[0]);
    assert.deepEqual(await run(ctx, refreshArgs(clientId, issued.refresh_token)), { error: "invalid_grant" }, label);
    assert.equal(typeof rows.externalMcpGrants[0].revokedAt, "number", label);
  }
}));

test("a blocked account loses grant access, refresh and code exchange", () => withSite(async () => {
  const { rows, ctx } = oauthState();
  const { clientId, code } = await authorize(ctx, ["history:read"]);
  const issued = tokens(await run(ctx, code));
  const pending = await authorize(ctx, ["history:read"]);
  rows.accountAccessBlocks.push({ _id: "block", userId: "user_1", source: "admin", reason: "test", blockedAt: 1 });
  await assert.rejects(authenticateGrant(ctx, issued.access_token), /invalid_token/);
  await assert.rejects(run(ctx, refreshArgs(clientId, issued.refresh_token)), /invalid_grant/);
  await assert.rejects(run(ctx, pending.code), /invalid_grant/);
}));

test("runtime:local needs chat:tools at consent, and a turn's routes follow the granted scopes", () => withSite(async () => {
  const { ctx } = oauthState();
  await assert.rejects(authorize(ctx, ["chat:write", "runtime:local"]), /invalid_scope/);
  const { code } = await authorize(ctx, ["chat:write", "chat:tools", "runtime:local"]);
  assert.equal(tokens(await run(ctx, code)).scope, "chat:write chat:tools runtime:local");
  assert.deepEqual(turnAccess(["chat:write"]), { tools: false, local: false });
  assert.deepEqual(turnAccess(["chat:write", "runtime:local"]), { tools: false, local: false });
  assert.deepEqual(turnAccess(["chat:write", "chat:tools", "runtime:local"]), { tools: true, local: true });
  const routes: Rows = {
    chatParticipants: [{ _id: "local", userId: "user_1", chatId: "chat", personaId: "persona" }, { _id: "bare", userId: "user_1", chatId: "chat", modelId: "openai/gpt-5" }],
    personas: [{ _id: "persona", userId: "user_1", modelId: "openai/gpt-5" }],
    personaRuntimeBindings: [],
    chatRuntimeOverrides: [{ _id: "override", chatId: "chat", status: "active", deviceId: "dev-1", adapterId: "codex", routeHash: "hash" }],
    runtimeDevices: [],
  };
  const routeCtx = createStatefulMockCtx(routes) as unknown as QueryCtx;
  const participants = (ids: string[]) => routes.chatParticipants.filter(row => ids.includes(row._id as string)) as never;
  await assertTurnRoutesAllowed(routeCtx, "user_1", participants(["bare"]), turnAccess(["chat:write"]));
  await assertTurnRoutesAllowed(routeCtx, "user_1", participants(["local"]), turnAccess(["chat:write", "chat:tools", "runtime:local"]));
  for (const scopes of [["chat:write"], ["chat:write", "chat:tools"]]) {
    await assert.rejects(assertTurnRoutesAllowed(routeCtx, "user_1", participants(["bare", "local"]), turnAccess(scopes)), /SCOPE_REQUIRED/);
  }
}));

test("registration is bounded in size, name and redirect URIs", () => withSite(async () => {
  const { rows, ctx } = oauthState();
  const action = { runMutation: async (ref: unknown, args: Record<string, unknown>) => {
    assert.equal(getFunctionName(ref as never), "external_mcp/oauth:registerClient");
    return await handler<Record<string, unknown>, unknown>(registerClient)(ctx, args);
  } } as unknown as ActionCtx;
  const post = (body: string) => oauthHttp(action, new Request(`${SITE}/oauth/register`, { method: "POST", body }));
  const valid = { client_name: "QA", redirect_uris: [REDIRECT] };
  assert.equal((await post(JSON.stringify(valid))).status, 201);
  assert.equal((await post(JSON.stringify({ ...valid, client_name: "x".repeat(101) }))).status, 400);
  assert.equal((await post(JSON.stringify({ ...valid, redirect_uris: Array(6).fill(REDIRECT) }))).status, 400);
  assert.equal((await post(JSON.stringify({ ...valid, redirect_uris: [`https://example.com/${"x".repeat(512)}`] }))).status, 400);
  assert.equal((await post(JSON.stringify({ ...valid, padding: "x".repeat(9 * 1024) }))).status, 413);
  assert.equal(rows.externalMcpClients.length, 1);
}));

test("cleanup removes expired requests, old refresh history and clients that never obtained a grant", async () => {
  const now = Date.now();
  const rows: Rows = {
    externalMcpAuthorizations: [{ _id: "old", clientId: "unused", expiresAt: now - DAY }, { _id: "fresh", clientId: "used", expiresAt: now + 60_000 }],
    externalMcpRefreshHistory: [{ _id: "ancient", retiredAt: now - REFRESH_ABSOLUTE_MS - DAY }, { _id: "recent", retiredAt: now - DAY }],
    externalMcpClients: [{ _id: "c1", clientId: "unused", createdAt: now - 2 * DAY }, { _id: "c2", clientId: "used", createdAt: now - 2 * DAY }, { _id: "c3", clientId: "new", createdAt: now }],
    externalMcpGrants: [{ _id: "g", clientId: "used", userId: "user_1" }],
  };
  const state = createStatefulMockCtx(rows);
  const ctx = state as unknown as MutationCtx;
  assert.deepEqual(await handler<Record<string, never>, unknown>(pruneExpiredOAuthRows)(ctx, {}), { authorizations: 1, history: 1 });
  const cutoff = state.scheduled.at(-1)?.cutoff as number;
  assert.ok(cutoff <= now - DAY + 1000);
  assert.equal(await handler<{ cutoff: number }, number>(pruneUnusedClients)(ctx, { cutoff }), 1);
  assert.deepEqual(rows.externalMcpClients.map(row => row._id), ["c2", "c3"]);
  assert.deepEqual(rows.externalMcpAuthorizations.map(row => row._id), ["fresh"]);
});

test("connections hide revoked and expired grants without changing the payload", async () => {
  const now = Date.now();
  const grant = (id: string, extra: Record<string, unknown>) => ({ _id: id, userId: "user_1", name: id, scopes: ["history:read"], createdAt: now, accessExpiresAt: now, refreshExpiresAt: now + DAY, lastUsedAt: now, ...extra });
  const rows: Rows = { accountDeletionTombstones: [], accountAccessBlocks: [], externalMcpGrants: [grant("live", {}), grant("revoked", { revokedAt: now }), grant("idle", { lastUsedAt: now - REFRESH_IDLE_MS - 1 })] };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;
  Object.assign(ctx, { auth: { getUserIdentity: async () => ({ subject: "user_1" }) } });
  Object.assign(ctx.db, { system: {} });
  const list = await handler<Record<string, never>, unknown[]>(listMyConnections)(ctx, {});
  assert.deepEqual(list, [{ id: "live" as Id<"externalMcpGrants">, name: "live", scopes: ["history:read"], createdAt: now }]);
});
