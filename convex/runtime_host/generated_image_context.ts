import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { RUNTIME_LIMITS } from "./protocol_common";

export async function getOwnedGeneratedMessageImages(
  ctx: QueryCtx,
  args: { userId: string; chatId: Id<"chats">; messageId: Id<"messages"> },
) {
  const message = await ctx.db.get(args.messageId);
  if (!message?.imageUrls?.length || message.chatId !== args.chatId
    || (message.userId !== undefined && message.userId !== args.userId)) return [];
  const chat = await ctx.db.get(args.chatId);
  if (chat?.userId !== args.userId) return [];
  const rows = await ctx.db.query("generatedMedia")
    .withIndex("by_messageId", query => query.eq("messageId", args.messageId))
    .take(RUNTIME_LIMITS.maxPartsPerMessage);
  const images = await Promise.all(rows.map(async media => {
    if (media.userId !== args.userId || media.chatId !== args.chatId
      || media.messageId !== args.messageId || media.type !== "image") return null;
    const [url, metadata] = await Promise.all([
      ctx.storage.getUrl(media.storageId), ctx.storage.getMetadata(media.storageId),
    ]);
    if (!url || !message.imageUrls?.includes(url) || !metadata
      || metadata.contentType?.toLowerCase() !== media.mimeType.toLowerCase()
      || (media.sizeBytes !== undefined && media.sizeBytes !== metadata.size)) return null;
    return { url, storageId: media.storageId, mimeType: media.mimeType, sizeBytes: metadata.size };
  }));
  return images.filter(image => image !== null);
}

export const listForMessage = internalQuery({
  args: { userId: v.string(), chatId: v.id("chats"), messageId: v.id("messages") },
  returns: v.array(v.object({ url: v.string(), storageId: v.id("_storage"),
    mimeType: v.string(), sizeBytes: v.number() })),
  handler: getOwnedGeneratedMessageImages,
});
