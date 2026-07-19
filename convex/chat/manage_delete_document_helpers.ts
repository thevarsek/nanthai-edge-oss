import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { storageHasDurableReferences } from "../knowledge_base/delete_helpers";

export async function deleteDocumentVersionsForChatDocument(
  ctx: MutationCtx,
  document: Doc<"documents">,
  batchSize: number,
): Promise<number> {
  const versions = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (query) => query.eq("documentId", document._id))
    .take(batchSize);
  for (const version of versions) {
    if (version.extractionTextStorageId) {
      await ctx.storage.delete(version.extractionTextStorageId).catch(() => undefined);
    }
    if (version.extractionMarkdownStorageId) {
      await ctx.storage.delete(version.extractionMarkdownStorageId).catch(() => undefined);
    }
    await ctx.db.delete(version._id);
    if (!await storageHasDurableReferences(ctx, document.userId, version.storageId)) {
      await ctx.storage.delete(version.storageId).catch(() => undefined);
    }
  }
  return versions.length;
}
