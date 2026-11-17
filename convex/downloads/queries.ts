import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { assertOwnedStorage } from "../lib/storage_ownership";

/** True when `userId` owns the blob through a durable file record or message audio. */
export async function ownsDownloadableStorageHandler(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  storageId: Id<"_storage">,
): Promise<boolean> {
  try {
    await assertOwnedStorage(ctx, userId, storageId);
    return true;
  } catch {
    const message = await ctx.db
      .query("messages")
      .withIndex("by_audio_storage", (q) => q.eq("audioStorageId", storageId))
      .first();
    return message?.userId === userId;
  }
}

export const ownsDownloadableStorage = internalQuery({
  args: { storageId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
    if (!storageId) return false;
    return await ownsDownloadableStorageHandler(ctx, userId, storageId);
  },
});
