// convex/external_mcp/cleanup.ts
// Hourly retention for unauthenticated OAuth rows: expired authorization
// requests, registered clients that never obtained a grant, and retired
// refresh-token hashes older than any grant can live.

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { CODE_MS, REFRESH_ABSOLUTE_MS } from "./policy";

export const UNUSED_CLIENT_RETENTION_MS = 24 * 60 * 60_000;
const PAGE = 200;
const CLIENT_PAGE = 100;

export const pruneExpiredOAuthRows = internalMutation({
  args: {},
  returns: v.object({ authorizations: v.number(), history: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    // A code issued at consent can outlive its request by CODE_MS.
    const authorizations = await ctx.db.query("externalMcpAuthorizations")
      .withIndex("by_expiry", q => q.lt("expiresAt", now - CODE_MS)).take(PAGE);
    for (const row of authorizations) await ctx.db.delete(row._id);
    const history = await ctx.db.query("externalMcpRefreshHistory")
      .withIndex("by_retired", q => q.lt("retiredAt", now - REFRESH_ABSOLUTE_MS)).take(PAGE);
    for (const row of history) await ctx.db.delete(row._id);
    if (authorizations.length === PAGE || history.length === PAGE) {
      await ctx.scheduler.runAfter(0, internal.external_mcp.cleanup.pruneExpiredOAuthRows, {});
    }
    await ctx.scheduler.runAfter(0, internal.external_mcp.cleanup.pruneUnusedClients, {
      cutoff: now - UNUSED_CLIENT_RETENTION_MS,
    });
    return { authorizations: authorizations.length, history: history.length };
  },
});

export const pruneUnusedClients = internalMutation({
  args: { cutoff: v.number(), cursor: v.optional(v.string()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("externalMcpClients")
      .withIndex("by_created", q => q.lt("createdAt", args.cutoff))
      .paginate({ cursor: args.cursor ?? null, numItems: CLIENT_PAGE });
    let deleted = 0;
    for (const client of page.page) {
      const grant = await ctx.db.query("externalMcpGrants").withIndex("by_client", q => q.eq("clientId", client.clientId)).first();
      if (grant) continue;
      const requests = await ctx.db.query("externalMcpAuthorizations")
        .withIndex("by_client", q => q.eq("clientId", client.clientId)).take(PAGE);
      for (const request of requests) await ctx.db.delete(request._id);
      await ctx.db.delete(client._id);
      deleted += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.external_mcp.cleanup.pruneUnusedClients, {
        cutoff: args.cutoff,
        cursor: page.continueCursor,
      });
    }
    return deleted;
  },
});
