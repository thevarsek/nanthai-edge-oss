// convex/external_mcp/token_exchange.ts
// OAuth token endpoint logic for external MCP clients (public clients, PKCE).
// Refresh tokens rotate on every use. The previous token stays usable for a
// short grace window (a retry after a lost response); any later reuse of a
// rotated token, or a replayed authorization code, revokes the whole grant.
//
// Revocation paths RETURN `{ error }` instead of throwing, because a thrown
// error would roll back the revocation write with the rest of the mutation.

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { sha256Hex } from "../runtime_host/security";
import {
  ACCESS_MS, REFRESH_ABSOLUTE_MS, REFRESH_GRACE_MS, assertGrantAccountActive, assertScopeSet,
  grantRefreshExpired, oauthError, pkceChallenge, requestedScopes, token,
} from "./policy";

export type ExchangeArgs = {
  grantType: string; clientId: string; code?: string; verifier?: string; redirectUri?: string;
  refreshToken?: string; resource?: string; scope?: string;
};
export type TokenResponse = {
  access_token: string; refresh_token: string; token_type: "Bearer"; expires_in: number; scope: string;
};
export type ExchangeResult = TokenResponse | { error: "invalid_grant" };

async function revokeGrant(ctx: MutationCtx, grantId: Id<"externalMcpGrants">, now: number): Promise<{ error: "invalid_grant" }> {
  const grant = await ctx.db.get(grantId);
  if (grant && grant.revokedAt === undefined) await ctx.db.patch(grant._id, { revokedAt: now });
  return { error: "invalid_grant" };
}

/** Resolve the grant for a presented refresh token, or the reason to revoke it. */
async function grantForRefresh(
  ctx: MutationCtx,
  refreshHash: string,
  clientId: string,
  now: number,
): Promise<Doc<"externalMcpGrants"> | { revoke: Id<"externalMcpGrants"> }> {
  const current = await ctx.db.query("externalMcpGrants").withIndex("by_refresh", q => q.eq("refreshHash", refreshHash)).unique();
  if (current) return current;
  const retired = await ctx.db.query("externalMcpRefreshHistory").withIndex("by_hash", q => q.eq("refreshHash", refreshHash)).first();
  if (!retired) oauthError("invalid_grant");
  const grant = await ctx.db.get(retired.grantId);
  if (!grant || grant.revokedAt !== undefined || grant.clientId !== clientId) oauthError("invalid_grant");
  // A rotated token presented after the grace window was copied or stolen.
  if (now - retired.retiredAt > REFRESH_GRACE_MS) return { revoke: grant._id };
  return grant;
}

async function refresh(ctx: MutationCtx, args: ExchangeArgs, now: number): Promise<ExchangeResult> {
  const presentedHash = await sha256Hex(args.refreshToken ?? "");
  const resolved = await grantForRefresh(ctx, presentedHash, args.clientId, now);
  if ("revoke" in resolved) return await revokeGrant(ctx, resolved.revoke, now);
  const grant = resolved;
  if (grant.revokedAt !== undefined || grant.clientId !== args.clientId || (args.resource && grant.resource !== args.resource)) oauthError("invalid_grant");
  if (grantRefreshExpired(grant, now)) return await revokeGrant(ctx, grant._id, now);
  await assertGrantAccountActive(ctx, grant.userId, "invalid_grant");
  const scopes = args.scope !== undefined ? requestedScopes(args.scope) : grant.scopes;
  if (scopes.some(scope => !grant.scopes.includes(scope))) oauthError("invalid_scope");
  assertScopeSet(scopes);
  const accessToken = token();
  const refreshToken = token();
  await ctx.db.insert("externalMcpRefreshHistory", { userId: grant.userId, grantId: grant._id, refreshHash: grant.refreshHash, retiredAt: now });
  await ctx.db.patch(grant._id, {
    accessHash: await sha256Hex(accessToken), accessScopes: scopes, accessExpiresAt: now + ACCESS_MS,
    refreshHash: await sha256Hex(refreshToken), lastUsedAt: now,
    refreshExpiresAt: grant.refreshExpiresAt ?? grant.createdAt + REFRESH_ABSOLUTE_MS,
  });
  return { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: ACCESS_MS / 1000, scope: scopes.join(" ") };
}

async function exchangeCode(ctx: MutationCtx, args: ExchangeArgs, now: number): Promise<ExchangeResult> {
  const codeHash = await sha256Hex(args.code ?? "");
  const pending = await ctx.db.query("externalMcpAuthorizations").withIndex("by_code", q => q.eq("codeHash", codeHash)).unique();
  // RFC 6749 §4.1.2: a reused code revokes the tokens it already produced.
  if (pending?.consumedAt !== undefined && pending.grantId) return await revokeGrant(ctx, pending.grantId, now);
  if (!pending?.userId || pending.consumedAt !== undefined || (pending.codeExpiresAt ?? 0) <= now || pending.clientId !== args.clientId
    || pending.redirectUri !== args.redirectUri || (args.resource && args.resource !== pending.resource)
    || await pkceChallenge(args.verifier ?? "") !== pending.challenge) oauthError("invalid_grant");
  await assertGrantAccountActive(ctx, pending.userId, "invalid_grant");
  assertScopeSet(pending.scopes);
  const accessToken = token();
  const refreshToken = token();
  const client = await ctx.db.query("externalMcpClients").withIndex("by_client", q => q.eq("clientId", pending.clientId)).unique();
  const grantId = await ctx.db.insert("externalMcpGrants", {
    userId: pending.userId, clientId: pending.clientId, name: client?.name ?? "MCP client", resource: pending.resource,
    scopes: pending.scopes, accessScopes: pending.scopes, accessHash: await sha256Hex(accessToken), accessExpiresAt: now + ACCESS_MS,
    refreshHash: await sha256Hex(refreshToken), createdAt: now, refreshExpiresAt: now + REFRESH_ABSOLUTE_MS, lastUsedAt: now,
  });
  await ctx.db.patch(pending._id, { consumedAt: now, grantId });
  return { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: ACCESS_MS / 1000, scope: pending.scopes.join(" ") };
}

export async function exchangeHandler(ctx: MutationCtx, args: ExchangeArgs): Promise<ExchangeResult> {
  const now = Date.now();
  if (args.grantType === "refresh_token") return await refresh(ctx, args, now);
  if (args.grantType !== "authorization_code") oauthError("unsupported_grant_type");
  return await exchangeCode(ctx, args, now);
}
