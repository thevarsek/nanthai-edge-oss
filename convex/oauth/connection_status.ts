import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getConnectionStatus = internalQuery({
  args: {
    userId: v.string(),
    provider: v.string(),
  },
  returns: v.union(
    v.object({
      status: v.string(),
      scopes: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const connection = await ctx.db
      .query("oauthConnections")
      .withIndex("by_user_provider", (query) =>
        query.eq("userId", args.userId).eq("provider", args.provider),
      )
      .unique();
    return connection
      ? { status: connection.status, scopes: connection.scopes }
      : null;
  },
});
