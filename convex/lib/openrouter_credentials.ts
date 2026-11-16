import type { MutationCtx } from "../_generated/server";

/**
 * Delete a user's stored OpenRouter credential rows.
 *
 * Rows are deleted, never overwritten: clients detect the missing `userSecrets`
 * row through `scheduledJobs/queries:hasApiKey` and prompt the user to reconnect.
 * `deleted` reports whether a `userSecrets` row existed and was removed.
 */
export async function deleteOpenRouterCredentials(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
): Promise<{ deleted: boolean }> {
  const existing = await ctx.db
    .query("userSecrets")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing) {
    await ctx.db.delete(existing._id);
  }
  const exchangeAttempt = await ctx.db
    .query("openRouterExchangeAttempts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (exchangeAttempt) await ctx.db.delete(exchangeAttempt._id);
  return { deleted: existing !== null && existing !== undefined };
}
