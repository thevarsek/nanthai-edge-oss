import type { MutationCtx } from "../_generated/server";
import type { PurgeTable } from "./purge_tables";
import { storageHasContentReferences } from "../knowledge_base/delete_helpers";

/**
 * Deletes one bounded batch for M46/M47 tables that cannot use the generic
 * account purge path. `undefined` means the table is handled elsewhere.
 */
export async function deleteDurableOrchestrationBatch(
  ctx: MutationCtx,
  tableName: PurgeTable,
  userId: string,
  batchSize: number,
  cursor?: string,
): Promise<number | { deleted: number; cursor?: string; done: boolean } | undefined> {
  let processed = 0;

  if (tableName === "generationContinuations") {
    const rows = await ctx.db
      .query("generationContinuations")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .take(batchSize);
    for (const row of rows) {
      if (row.scheduledFunctionId) {
        await ctx.scheduler.cancel(row.scheduledFunctionId).catch(() => undefined);
      }
      await ctx.db.delete(row._id);
      processed++;
    }
    return processed;
  }

  if (tableName === "researchSearchTasks" || tableName === "researchSearchBatches") {
    const page = await ctx.db
      .query("searchSessions")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .paginate({ cursor: cursor ?? null, numItems: 25 });
    for (const session of page.page) {
      if (processed >= batchSize) break;
      const remaining = batchSize - processed;
      if (tableName === "researchSearchTasks") {
        const rows = await ctx.db
          .query("researchSearchTasks")
          .withIndex("by_session", (query) => query.eq("sessionId", session._id))
          .take(remaining);
        for (const row of rows) {
          await ctx.db.delete(row._id);
          processed++;
        }
      } else {
        const rows = await ctx.db
          .query("researchSearchBatches")
          .withIndex("by_session", (query) => query.eq("sessionId", session._id))
          .take(remaining);
        for (const row of rows) {
          await ctx.db.delete(row._id);
          processed++;
        }
      }
    }
    return processed >= batchSize
      ? { deleted: processed, cursor, done: false }
      : { deleted: processed, cursor: page.continueCursor, done: page.isDone };
  }

  if (tableName === "analyticsArtifactIntents") {
    const owned = await ctx.db
      .query("analyticsArtifactIntents")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .take(batchSize);
    for (const row of owned) {
      if (row.storageId) await ctx.storage.delete(row.storageId).catch(() => undefined);
      await ctx.db.delete(row._id);
      processed++;
    }
    if (processed >= batchSize) return processed;

    const legacy = await ctx.db
      .query("analyticsArtifactIntents")
      .withIndex("by_user", (query) => query.eq("userId", undefined))
      .take(batchSize - processed);
    for (const row of legacy) {
      const run = await ctx.db.get(row.analyticsRunId);
      if (!run || run.userId === userId) {
        if (row.storageId) await ctx.storage.delete(row.storageId).catch(() => undefined);
        await ctx.db.delete(row._id);
      } else {
        await ctx.db.patch(row._id, { userId: run.userId });
      }
      processed++;
    }
    return processed;
  }

  if (tableName === "analyticsWorkflowRuns") {
    const rows = await ctx.db
      .query("analyticsWorkflowRuns")
      .withIndex("by_user_status", (query) => query.eq("userId", userId))
      .take(batchSize);
    for (const row of rows) {
      for (const storageId of [
        row.executionEnvelopeStorageId,
        row.normalizedResultStorageId,
        row.resultStorageId,
      ]) {
        if (storageId) await ctx.storage.delete(storageId).catch(() => undefined);
      }
      await ctx.db.delete(row._id);
      processed++;
    }
    return processed;
  }

  if (tableName === "videoOutputUploads") {
    const rows = await ctx.db
      .query("videoOutputUploads")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .take(batchSize);
    for (const row of rows) {
      if (row.storageId && !await storageHasContentReferences(ctx, row.storageId)) {
        await ctx.storage.delete(row.storageId).catch(() => undefined);
      }
      await ctx.db.delete(row._id);
      processed++;
    }
    return processed;
  }

  if (tableName === "streamingMessages") {
    const owned = await ctx.db
      .query("streamingMessages")
      .withIndex("by_user", (query) => query.eq("userId", userId))
      .take(batchSize);
    for (const row of owned) {
      await ctx.db.delete(row._id);
      processed++;
    }
    if (processed >= batchSize) return processed;

    // Older rows predate the denormalized userId. Backfill foreign rows while
    // deleting owned/orphaned rows so the durable cursor can eventually pass.
    const legacy = await ctx.db
      .query("streamingMessages")
      .withIndex("by_user", (query) => query.eq("userId", undefined))
      .take(batchSize - processed);
    for (const row of legacy) {
      const chat = await ctx.db.get(row.chatId);
      if (!chat || chat.userId === userId) {
        await ctx.db.delete(row._id);
      } else {
        await ctx.db.patch(row._id, { userId: chat.userId });
      }
      processed++;
    }
    return processed;
  }

  return undefined;
}
