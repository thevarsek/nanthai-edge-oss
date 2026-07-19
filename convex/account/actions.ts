// convex/account/actions.ts
// Account deletion action — orchestrates full user data purge.
// Required by Apple App Store guideline 5.1.1(v).

import { action, internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { PURGE_TABLES } from "./purge_tables";
import { ConvexError } from "convex/values";
import { v } from "convex/values";

/**
 * Delete all user data from Convex. Called from the iOS client before
 * deleting the Clerk account and clearing the Keychain.
 *
 * Processes each table in batches to stay within Convex transaction limits.
 * Returns the total number of rows deleted.
 */
export const deleteAccount = action({
  args: {},
  handler: async (ctx): Promise<{ totalDeleted: number }> => {
    const { userId } = await requireAuth(ctx, { allowAccountDeletion: true });
    let totalDeleted = 0;

    // Install an immutable write fence before cancellation/purge. It is kept
    // until the upstream identity disappears so a retry cannot race new work.
    await ctx.runMutation(internal.account.deletion_state.beginAccountDeletion, { userId });

    const cancellationConfirmed: boolean = await ctx.runAction(
      internal.execution.teardown.cancelUserExecutions,
      {
      userId,
      reason: "Account deleted",
      },
    );
    if (!cancellationConfirmed) {
      throw new ConvexError({
        code: "EXECUTION_CANCELLATION_PENDING",
        message: "Active work is still being cancelled. Please retry account deletion shortly.",
      });
    }

    const purge = await ctx.runAction(
      internal.account.actions.continueAccountDeletionPurge,
      { userId },
    );
    totalDeleted = purge.totalDeleted;
    if (!purge.completed) {
      throw new ConvexError({
        code: "ACCOUNT_DELETION_PENDING",
        message: "Account data deletion is continuing safely. Please retry shortly.",
      });
    }
    return { totalDeleted };
  },
});

const PURGE_BATCHES_PER_ACTION = 20;

export const continueAccountDeletionPurge = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, args): Promise<{ completed: boolean; totalDeleted: number }> => {
    const existing = await ctx.runQuery(
      internal.account.deletion_state.getAccountDeletionState,
      args,
    );
    if (existing?.status === "completed") {
      return { completed: true, totalDeleted: existing.totalDeleted ?? 0 };
    }
    const leaseId = crypto.randomUUID();
    const leased = await ctx.runMutation(
      internal.account.deletion_state.acquireAccountPurgeLease,
      { ...args, leaseId, now: Date.now() },
    );
    if (!leased) {
      return { completed: false, totalDeleted: existing?.totalDeleted ?? 0 };
    }
    let tableIndex = leased.tableIndex;
    let cursor = leased.cursor;
    let totalDeleted = leased.totalDeleted;
    for (
      let batch = 0;
      batch < PURGE_BATCHES_PER_ACTION && tableIndex < PURGE_TABLES.length;
      batch += 1
    ) {
      const renewed = await ctx.runMutation(
        internal.account.deletion_state.renewAccountPurgeLease,
        { ...args, leaseId, now: Date.now() },
      );
      if (!renewed) return { completed: false, totalDeleted };
      const tableName = PURGE_TABLES[tableIndex];
      const result: { deleted: number; cursor?: string; done?: boolean } = await ctx.runMutation(
        internal.account.mutations.deleteUserTableBatch,
        { userId: args.userId, tableName, cursor },
      );
      totalDeleted += result.deleted;
      if (result.done === true || (result.done === undefined && result.deleted < 200)) {
        tableIndex += 1;
        cursor = undefined;
      } else {
        cursor = result.cursor;
      }
    }
    const completed = tableIndex >= PURGE_TABLES.length;
    const saved = await ctx.runMutation(internal.account.deletion_state.saveAccountPurgeProgress, {
      ...args,
      leaseId,
      tableIndex,
      cursor,
      totalDeleted,
      completed,
    });
    if (!saved) return { completed: false, totalDeleted };
    if (!completed) {
      await ctx.scheduler.runAfter(
        0,
        internal.account.actions.continueAccountDeletionPurge,
        args,
      );
    }
    return { completed, totalDeleted };
  },
});
