import { v } from "convex/values";
import { internalMutation, mutation, query } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { sha256Hex } from "../runtime_host/security";
import { ACCESS_MS, CODE_MS, grantedContext, oauthError, pkceChallenge, requestedScopes, token, validRedirect } from "./policy";

export const registerClient = internalMutation({
  args: { name: v.string(), redirectUris: v.array(v.string()) },
  handler: async (ctx, args) => {
    if (!args.redirectUris.length || args.redirectUris.some(uri => !validRedirect(uri))) oauthError("invalid_redirect_uri");
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
    return client ? { name: client.name, redirectUri: pending.redirectUri, scopes: pending.scopes } : null;
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
  handler: async (ctx, args) => {
    const now = Date.now();
    const accessToken = token();
    const accessHash = await sha256Hex(accessToken);
    if (args.grantType === "refresh_token") {
      const hash = await sha256Hex(args.refreshToken ?? "");
      const grant = await ctx.db.query("externalMcpGrants").withIndex("by_refresh", q => q.eq("refreshHash", hash)).unique();
      if (!grant || grant.revokedAt !== undefined || grant.clientId !== args.clientId || (args.resource && grant.resource !== args.resource)) oauthError("invalid_grant");
      await requireAuth(grantedContext(ctx, grant.userId));
      const scopes = args.scope !== undefined ? requestedScopes(args.scope) : grant.scopes;
      if (scopes.some(scope => !grant.scopes.includes(scope))) oauthError("invalid_scope");
      await ctx.db.patch(grant._id, { accessHash, accessScopes: scopes, accessExpiresAt: now + ACCESS_MS });
      return { access_token: accessToken, token_type: "Bearer", expires_in: ACCESS_MS / 1000, scope: scopes.join(" ") };
    }
    if (args.grantType !== "authorization_code") oauthError("unsupported_grant_type");
    const hash = await sha256Hex(args.code ?? "");
    const pending = await ctx.db.query("externalMcpAuthorizations").withIndex("by_code", q => q.eq("codeHash", hash)).unique();
    if (!pending?.userId || pending.consumedAt !== undefined || (pending.codeExpiresAt ?? 0) <= now || pending.clientId !== args.clientId
      || pending.redirectUri !== args.redirectUri || (args.resource && args.resource !== pending.resource)
      || await pkceChallenge(args.verifier ?? "") !== pending.challenge) oauthError("invalid_grant");
    await requireAuth(grantedContext(ctx, pending.userId));
    const refreshToken = token();
    const client = await ctx.db.query("externalMcpClients").withIndex("by_client", q => q.eq("clientId", pending.clientId)).unique();
    await ctx.db.insert("externalMcpGrants", { userId: pending.userId, clientId: pending.clientId, name: client?.name ?? "MCP client", resource: pending.resource,
      scopes: pending.scopes, accessScopes: pending.scopes, accessHash, accessExpiresAt: now + ACCESS_MS, refreshHash: await sha256Hex(refreshToken), createdAt: now });
    await ctx.db.patch(pending._id, { consumedAt: now });
    return { access_token: accessToken, refresh_token: refreshToken, token_type: "Bearer", expires_in: ACCESS_MS / 1000, scope: pending.scopes.join(" ") };
  },
});
export const listMyConnections = query({
  args: {}, handler: async ctx => {
    const { userId } = await requireAuth(ctx);
    return (await ctx.db.query("externalMcpGrants").withIndex("by_user", q => q.eq("userId", userId)).collect())
      .filter(grant => grant.revokedAt === undefined).map(grant => ({ id: grant._id, name: grant.name, scopes: grant.scopes, createdAt: grant.createdAt }));
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
