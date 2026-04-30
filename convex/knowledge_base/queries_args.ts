// convex/knowledge_base/queries_args.ts
// Validators for KB public queries. Kept in a separate file (matching the
// `convex/chat/` pattern) so handlers can be unit-tested without pulling
// in the Convex `query()` wrapper.

import { v } from "convex/values";
import { PropertyValidators } from "convex/values";

export const listKnowledgeBaseFilesArgs = {
  search: v.optional(v.string()),
  source: v.optional(
    v.union(
      v.literal("upload"),
      v.literal("generated"),
      v.literal("drive"),
      v.literal("all"),
    ),
  ),
  folderId: v.optional(v.id("folders")),
  folderFilter: v.optional(
    v.union(
      v.literal("all"),
      v.literal("unfiled"),
    ),
  ),
  limit: v.optional(v.number()),
} satisfies PropertyValidators;

export const getKnowledgeBaseFilesByStorageIdsArgs = {
  storageIds: v.array(v.id("_storage")),
} satisfies PropertyValidators;
