// convex/knowledge_base/mutations_args.ts
import { v, PropertyValidators } from "convex/values";

export const addUploadToKnowledgeBaseArgs = {
  storageId: v.id("_storage"),
  uploadSessionId: v.id("kbUploadSessions"),
  filename: v.string(),
  mimeType: v.string(),
  sizeBytes: v.optional(v.number()),
} satisfies PropertyValidators;

export const deleteKnowledgeBaseFileArgs = {
  storageId: v.id("_storage"),
  fileAttachmentId: v.optional(v.id("fileAttachments")),
  // `"drive"` rows live in `fileAttachments` like `"upload"`, but clients
  // distinguish them in the listing so we accept both literals.
  source: v.union(
    v.literal("upload"),
    v.literal("generated"),
    v.literal("drive"),
  ),
} satisfies PropertyValidators;
