import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { requireAuth } from "../lib/auth";

const CHAT_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface ChatUploadSessionResult {
  uploadUrl: string;
  uploadSessionId: Id<"chatUploadSessions">;
}

export async function createChatUploadUrlHandler(
  ctx: MutationCtx,
): Promise<ChatUploadSessionResult> {
  const { userId } = await requireAuth(ctx);
  const uploadUrl = await ctx.storage.generateUploadUrl();
  const uploadSessionId = await ctx.db.insert("chatUploadSessions", {
    userId,
    status: "pending",
    createdAt: Date.now(),
  });
  return { uploadUrl, uploadSessionId };
}

export async function bindChatUploadSessionHandler(
  ctx: MutationCtx,
  args: { uploadSessionId: Id<"chatUploadSessions">; storageId: Id<"_storage"> },
): Promise<null> {
  const { userId } = await requireAuth(ctx);
  const session = await ctx.db.get(args.uploadSessionId);
  if (!session || session.userId !== userId || session.status !== "pending") {
    throw new ConvexError({
      code: "FORBIDDEN" as const,
      message: "Upload session is missing or already used.",
    });
  }
  if (session.storageId && session.storageId !== args.storageId) {
    throw new ConvexError({
      code: "VALIDATION" as const,
      message: "Upload session is already bound to another file.",
    });
  }
  if (!(await ctx.storage.getMetadata(args.storageId))) {
    throw new ConvexError({
      code: "VALIDATION" as const,
      message: "Uploaded file is missing.",
    });
  }
  await ctx.db.patch(args.uploadSessionId, { storageId: args.storageId });
  return null;
}

export async function cleanupChatUploadSessionHandler(
  ctx: MutationCtx,
  args: { uploadSessionId: Id<"chatUploadSessions">; storageId?: Id<"_storage"> },
): Promise<null> {
  const { userId } = await requireAuth(ctx);
  const session = await ctx.db.get(args.uploadSessionId);
  if (!session || session.userId !== userId) {
    throw new ConvexError({
      code: "FORBIDDEN" as const,
      message: "Upload session is missing or not owned by user.",
    });
  }
  if (session.status !== "pending") return null;
  if (args.storageId && session.storageId && args.storageId !== session.storageId) {
    throw new ConvexError({
      code: "VALIDATION" as const,
      message: "Upload session does not match this file.",
    });
  }

  const storageId = session.storageId ?? args.storageId;
  if (storageId) {
    const refs = await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .take(1);
    if (refs.length === 0) {
      try {
        await ctx.storage.delete(storageId);
      } catch {
        // Cleanup is idempotent if the upload endpoint already removed it.
      }
    }
  }
  await ctx.db.patch(args.uploadSessionId, {
    storageId,
    status: "cancelled",
  });
  return null;
}

export async function cleanupExpiredChatUploadSessionsHandler(
  ctx: MutationCtx,
): Promise<number> {
  const cutoff = Date.now() - CHAT_UPLOAD_RETENTION_MS;
  const sessions = await ctx.db
    .query("chatUploadSessions")
    .withIndex("by_status_createdAt", (q) => q.eq("status", "pending").lt("createdAt", cutoff))
    .take(100);
  let cleaned = 0;
  for (const session of sessions) {
    if (session.storageId) {
      const refs = await ctx.db
        .query("fileAttachments")
        .withIndex("by_storage", (q) => q.eq("storageId", session.storageId!))
        .take(1);
      if (refs.length === 0) {
        try {
          await ctx.storage.delete(session.storageId);
        } catch {
          // A missing blob is already clean.
        }
      }
    }
    await ctx.db.patch(session._id, { status: "cancelled" });
    cleaned += 1;
  }
  return cleaned;
}
