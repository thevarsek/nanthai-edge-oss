// convex/preferences/pro_client_state.ts
// Pro-gated client state cleanup run when a user's last active entitlement
// ends: client revocation, Stripe refunds or disputes, and store re-verification.
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export async function disableProClientState(ctx: MutationCtx, userId: string, now: number): Promise<void> {
  // 1. Reset Pro-gated preference fields.
  const prefs = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();

  if (prefs) {
    await ctx.db.patch(prefs._id, {
      isMemoryEnabled: false,
      memoryGatingMode: "disabled",
      memoryExtractionModelId: undefined,
      subagentsEnabledByDefault: false,
      updatedAt: now,
    });
  }

  // 2. Reset subagentOverride on all user chats, paginated to avoid the
  //    16,384-document read limit. First batch runs immediately; subsequent
  //    batches are scheduled so each runs in its own transaction.
  await ctx.scheduler.runAfter(
    0,
    internal.preferences.mutations.disableProChatsBatch,
    { userId, now },
  );

  // 3. Purge memories in a separate action.
  await ctx.scheduler.runAfter(0, internal.memory.operations.purgeUserMemories, {
    userId,
  });
}
