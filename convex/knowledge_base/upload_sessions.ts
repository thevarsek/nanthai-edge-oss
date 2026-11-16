import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { assertOwnedUploadedStorage, createOwnedUploadUrl, ownsUploadedStorage } from "../lib/storage_ownership";
import { cleanupUnclaimedUploadArgs } from "./mutations_args";
import { storageHasDurableReferences } from "./delete_helpers";

export const createKnowledgeBaseUploadUrl = mutation({
  args: {},
  returns: v.object({
    uploadUrl: v.string(),
    uploadSessionId: v.id("kbUploadSessions"),
  }),
  handler: async (ctx): Promise<{ uploadUrl: string; uploadSessionId: Id<"kbUploadSessions"> }> => {
    const { userId } = await requireAuth(ctx);
    const uploadUrl = await createOwnedUploadUrl(ctx, userId);
    const uploadSessionId = await ctx.db.insert("kbUploadSessions", {
      userId,
      status: "pending",
      createdAt: Date.now(),
    });
    return { uploadUrl, uploadSessionId };
  },
});

export const bindKnowledgeBaseUploadSession = mutation({
  args: {
    uploadSessionId: v.id("kbUploadSessions"),
    storageId: v.id("_storage"),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.uploadSessionId);
    if (!session || session.userId !== userId || session.status !== "pending") {
      throw new ConvexError({
        code: "FORBIDDEN" as const,
        message: "Upload session is missing or already used.",
      });
    }
    if (session.storageId && session.storageId !== args.storageId) {
      throw new ConvexError({ code: "VALIDATION", message: "Upload session is already bound to another file." });
    }
    await assertOwnedUploadedStorage(ctx, userId, args.storageId);
    await ctx.db.patch(args.uploadSessionId, { storageId: args.storageId });
    return null;
  },
});

export const cleanupUnclaimedUpload = mutation({
  args: cleanupUnclaimedUploadArgs,
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const { userId } = await requireAuth(ctx);
    const session = await ctx.db.get(args.uploadSessionId);
    if (!session || session.userId !== userId) {
      throw new ConvexError({
        code: "FORBIDDEN" as const,
        message: "Upload session is missing or not owned by user.",
      });
    }
    if (session.status !== "pending") {
      return null;
    }
    if (session.storageId && session.storageId !== args.storageId) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: "Upload session does not match this file.",
      });
    }

    const storageId = session.storageId;
    const owned = storageId && await ownsUploadedStorage(ctx, userId, storageId);
    const hasRefs = storageId && await storageHasDurableReferences(ctx, userId, storageId, args.uploadSessionId);
    if (storageId && owned && !hasRefs) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // The storage blob may already have been deleted by another cleanup.
      }
    }
    await ctx.db.patch(args.uploadSessionId, {
      status: "cancelled",
    });
    return null;
  },
});
