// convex/security/account_access_blocks.ts
// =============================================================================
// Admin and identity-provider account blocks. Internal only: run by the owner
// with `npx convex run` or by the verified Clerk webhook. A block fences every
// authenticated path at once (`lib/account_access.ts`) and then revokes the
// credentials NanthAI issued, so they stay dead after an unblock.
// =============================================================================

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { revokeAccountCredentialsPage, type AccountRevocationCounts } from "./account_access_revocation";

const source = v.union(v.literal("clerk"), v.literal("admin"));

async function findBlock(ctx: MutationCtx, userId: string) {
  return await ctx.db.query("accountAccessBlocks").withIndex("by_user", q => q.eq("userId", userId)).unique();
}

async function revokeAndContinue(ctx: MutationCtx, userId: string, reason: string): Promise<AccountRevocationCounts> {
  const { done, counts } = await revokeAccountCredentialsPage(ctx, userId, reason);
  if (!done) {
    await ctx.scheduler.runAfter(0, internal.security.account_access_blocks.continueAccountRevocation, { userId });
  }
  return counts;
}

export async function blockUserHandler(
  ctx: MutationCtx,
  args: { userId: string; reason: string; source: "clerk" | "admin" },
): Promise<{ created: boolean; source: "clerk" | "admin"; revoked: AccountRevocationCounts }> {
  const userId = args.userId.trim();
  if (!userId) throw new Error("USER_ID_REQUIRED");
  const reason = args.reason.trim().slice(0, 500) || "Account blocked";
  const now = Date.now();
  const existing = await findBlock(ctx, userId);
  let effectiveSource = args.source;
  if (!existing) {
    await ctx.db.insert("accountAccessBlocks", { userId, reason, source: args.source, blockedAt: now, updatedAt: now });
  } else if (existing.source === "clerk" && args.source === "admin") {
    // An admin block must survive a later identity-provider unban.
    await ctx.db.patch(existing._id, { source: "admin", reason, updatedAt: now });
  } else {
    effectiveSource = existing.source;
  }
  const revoked = await revokeAndContinue(ctx, userId, reason);
  // Centralized run-tree teardown; it paginates and reschedules itself.
  await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelUserExecutions, { userId, reason: "Account blocked" });
  return { created: !existing, source: effectiveSource, revoked };
}

export async function unblockUserHandler(
  ctx: MutationCtx,
  args: { userId: string; source?: "clerk" | "admin" },
): Promise<{ removed: boolean }> {
  const block = await findBlock(ctx, args.userId.trim());
  // An identity-provider unban removes only the block that provider created.
  if (!block || (args.source === "clerk" && block.source !== "clerk")) return { removed: false };
  await ctx.db.delete(block._id);
  return { removed: true };
}

/** Block an account and revoke everything NanthAI issued to it. Idempotent. */
export const blockUser = internalMutation({
  args: { userId: v.string(), reason: v.string(), source: v.optional(source) },
  handler: async (ctx, args) => await blockUserHandler(ctx, { ...args, source: args.source ?? "admin" }),
});

/** Remove the block only. Revoked credentials stay revoked. */
export const unblockUser = internalMutation({
  args: { userId: v.string(), source: v.optional(source) },
  handler: async (ctx, args) => await unblockUserHandler(ctx, args),
});

/** Paginated follow-up for accounts with many credentials. Stops on unblock. */
export const continueAccountRevocation = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const block = await findBlock(ctx, args.userId);
    if (block) await revokeAndContinue(ctx, args.userId, block.reason);
    return null;
  },
});
