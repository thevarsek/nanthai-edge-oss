import { v } from "convex/values";

export const telegramFile = v.object({
  fileId: v.string(), type: v.union(v.literal("image"), v.literal("document"), v.literal("video"), v.literal("audio"), v.literal("voice")),
  name: v.string(), mimeType: v.string(), sizeBytes: v.optional(v.number()), durationMs: v.optional(v.number()),
});
export const telegramUploadedFile = v.object({
  fileId: v.string(), storageId: v.id("_storage"), uploadSessionId: v.id("chatUploadSessions"),
  type: v.string(), name: v.string(), mimeType: v.string(), sizeBytes: v.number(), durationMs: v.optional(v.number()),
});
