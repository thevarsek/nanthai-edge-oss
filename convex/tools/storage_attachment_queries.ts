import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

function mediaFilename(type: "image" | "video", mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/avif": "avif",
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/svg+xml": "svg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  };
  return `generated-${type}.${extensions[mimeType.toLowerCase()] ?? (type === "video" ? "mp4" : "png")}`;
}

export const resolveOwnedStorageAttachments = internalQuery({
  args: {
    userId: v.string(),
    storageIds: v.array(v.id("_storage")),
  },
  returns: v.array(v.object({
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
  })),
  handler: async (ctx, args) => {
    if (args.storageIds.length > 10) throw new Error("TOO_MANY_ATTACHMENTS");
    const resolved = [];
    for (const storageId of args.storageIds) {
      const file = await ctx.db
        .query("generatedFiles")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();
      if (file?.userId === args.userId) {
        resolved.push({
          storageId,
          filename: file.filename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
        });
        continue;
      }
      const media = await ctx.db
        .query("generatedMedia")
        .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
        .first();
      if (media?.userId === args.userId) {
        resolved.push({
          storageId,
          filename: mediaFilename(media.type, media.mimeType),
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
        });
        continue;
      }
      const attachment = await ctx.db
        .query("fileAttachments")
        .withIndex("by_storage", (q) => q.eq("storageId", storageId))
        .first();
      if (attachment?.userId === args.userId) {
        resolved.push({
          storageId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
        });
      }
    }
    return resolved;
  },
});
