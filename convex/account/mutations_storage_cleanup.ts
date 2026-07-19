import type { MutationCtx } from "../_generated/server";
import type { PurgeTable } from "./purge_tables";
import { storageHasDurableReferences } from "../knowledge_base/delete_helpers";

/** Bounded storage-owning account purge branches. */
export async function deleteAccountStorageBatch(
  ctx: MutationCtx,
  tableName: PurgeTable,
  userId: string,
  batchSize: number,
): Promise<number | undefined> {
  if (tableName === "documentVersions") {
    const rows = await ctx.db
      .query("documentVersions")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .take(batchSize);
    for (const row of rows) {
      if (row.extractionTextStorageId) {
        await ctx.storage.delete(row.extractionTextStorageId).catch(() => undefined);
      }
      if (row.extractionMarkdownStorageId) {
        await ctx.storage.delete(row.extractionMarkdownStorageId).catch(() => undefined);
      }
      await ctx.db.delete(row._id);
      if (!await storageHasDurableReferences(ctx, userId, row.storageId)) {
        await ctx.storage.delete(row.storageId).catch(() => undefined);
      }
    }
    return rows.length;
  }

  if (tableName === "kbUploadSessions") {
    const rows = await ctx.db
      .query("kbUploadSessions")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .take(batchSize);
    for (const row of rows) {
      await ctx.db.delete(row._id);
      if (
        row.storageId
        && !await storageHasDurableReferences(ctx, userId, row.storageId)
      ) {
        await ctx.storage.delete(row.storageId).catch(() => undefined);
      }
    }
    return rows.length;
  }

  return undefined;
}
