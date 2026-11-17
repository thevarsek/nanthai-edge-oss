import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { buildDownloadUrl } from "./links";
import { ownsDownloadableStorageHandler } from "./queries";

/**
 * Fresh signed download link for a file the caller owns. Clients that only
 * hold a storage ID (for example message audio) use this instead of building
 * `/download?storageId=` themselves.
 */
export const createDownloadUrl = mutation({
  args: { storageId: v.string(), filename: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
    if (!storageId || !await ownsDownloadableStorageHandler(ctx, userId, storageId)) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "File not found" });
    }
    const url = await buildDownloadUrl(storageId, args.filename.slice(0, 255) || "download");
    if (!url) throw new ConvexError({ code: "UNAVAILABLE" as const, message: "Downloads are not configured" });
    return url;
  },
});
