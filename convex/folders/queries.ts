// convex/folders/queries.ts
// =============================================================================
// Folder queries.
// =============================================================================

import { v } from "convex/values";
import { query } from "../_generated/server";
import { optionalAuth, requireAuth } from "../lib/auth";
import { compareFoldersForDisplay } from "./shared";

/** List all folders for the authenticated user, sorted. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return [];
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .collect();
    return folders.sort(compareFoldersForDisplay);
  },
});

/** Get a single folder. */
export const get = query({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.userId !== userId) return null;
    return folder;
  },
});
