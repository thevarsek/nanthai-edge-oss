import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { sha256Hex } from "../runtime_host/security";
import { CODE_MS, assertScopeSet, grantRefreshExpired, oauthError, requestedScopes, token, validRedirect } from "./policy";
import { exchangeHandler } from "./token_exchange";

// Unauthenticated registration limits (also enforced on the HTTP body).
export const CLIENT_NAME_MAX = 100;
export const REDIRECT_URIS_MAX = 5;
export const REDIRECT_URI_MAX = 512;

export const registerClient = internalMutation({
  args: { name: v.string(), redirectUris: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (!args.redirectUris.length || args.redirectUris.length > REDIRECT_URIS_MAX
      || args.redirectUris.some(uri => uri.length > REDIRECT_URI_MAX || !validRedirect(uri))) oauthError("invalid_redirect_uri");
    if (args.name.length > CLIENT_NAME_MAX) oauthError("invalid_client_metadata");
    const clientId = crypto.randomUUID();
    await ctx.db.insert("externalMcpClients", { clientId, ...args, createdAt: Date.now() });
    return { client_id: clientId, client_name: args.name, redirect_uris: args.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] };
  },
});
export const begin = internalMutation({
  args: { clientId: v.string(), redirectUri: v.string(), resource: v.string(), challenge: v.string(), scope: v.string(), state: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const client = await ctx.db.query("externalMcpClients").withIndex("by_client", q => q.eq("clientId", args.clientId)).unique();
    if (!client || !client.redirectUris.includes(args.redirectUri)) oauthError("invalid_request");
    if (args.resource !== `${process.env.CONVEX_SITE_URL}/mcp` || !/^[A-Za-z0-9_-]{43}$/.test(args.challenge)) oauthError("invalid_target");
    const request = token();
    await ctx.db.insert("externalMcpAuthorizations", { requestHash: await sha256Hex(request), clientId: args.clientId,
      redirectUri: args.redirectUri, resource: args.resource, challenge: args.challenge, scopes: requestedScopes(args.scope),
      ...(args.state !== undefined ? { state: args.state } : {}), expiresAt: Date.now() + CODE_MS });
    return request;
  },
});
export const getConsent = query({
  args: { request: v.string() },
  handler: async (ctx, args) => {
    await requireAuth(ctx);
    const hash = await sha256Hex(args.request);
    const pending = await ctx.db.query("externalMcpAuthorizations").withIndex("by_request", q => q.eq("requestHash", hash)).unique();
    if (!pending || pending.expiresAt <= Date.now() || pending.userId) return null;
    const client = await ctx.db.query("externalMcpClients").withIndex("by_client", q => q.eq("clientId", pending.clientId)).unique();
    return client ? { name: client.name, isVerified: false, redirectUri: pending.redirectUri, redirectHost: new URL(pending.redirectUri).host, scopes: pending.scopes } : null;
  },
});
export const consent = mutation({
  args: { request: v.string(), scopes: v.array(v.string()), allow: v.boolean() },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const hash = await sha256Hex(args.request);
    const pending = await ctx.db.query("externalMcpAuthorizations").withIndex("by_request", q => q.eq("requestHash", hash)).unique();
    if (!pending || pending.expiresAt <= Date.now() || pending.userId) oauthError("invalid_request");
    if (args.scopes.some(scope => !pending.scopes.includes(scope))) oauthError("invalid_scope");
    if (args.allow) assertScopeSet(args.scopes);
    const redirect = new URL(pending.redirectUri);
    if (pending.state !== undefined) redirect.searchParams.set("state", pending.state);
    if (args.allow) {
      const code = token();
      await ctx.db.patch(pending._id, { userId, scopes: [...new Set(args.scopes)], codeHash: await sha256Hex(code), codeExpiresAt: Date.now() + CODE_MS });
      redirect.searchParams.set("code", code);
    } else {
      await ctx.db.patch(pending._id, { userId, consumedAt: Date.now() });
      redirect.searchParams.set("error", "access_denied");
    }
    return redirect.href;
  },
});
export const exchange = internalMutation({
  args: { grantType: v.string(), clientId: v.string(), code: v.optional(v.string()), verifier: v.optional(v.string()), redirectUri: v.optional(v.string()), refreshToken: v.optional(v.string()), resource: v.optional(v.string()), scope: v.optional(v.string()) },
  handler: async (ctx, args) => await exchangeHandler(ctx, args),
});
export const listMyConnections = query({
  args: {}, handler: async ctx => {
    const { userId } = await requireAuth(ctx);
    return (await ctx.db.query("externalMcpGrants").withIndex("by_user", q => q.eq("userId", userId)).collect())
      .filter(grant => grant.revokedAt === undefined && !grantRefreshExpired(grant, Date.now())).map(grant => ({ id: grant._id, name: grant.name, scopes: grant.scopes, createdAt: grant.createdAt }));
  },
});
export const revoke = mutation({
  args: { grantId: v.id("externalMcpGrants") }, handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const grant = await ctx.db.get(args.grantId);
    if (!grant || grant.userId !== userId) oauthError("invalid_request");
    await ctx.db.patch(grant._id, { revokedAt: Date.now() });
    return null;
  },
});
