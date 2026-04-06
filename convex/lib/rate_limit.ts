// convex/lib/rate_limit.ts
// =============================================================================
// Lightweight per-user rate limiting for public mutations.
//
// Uses the `messages` table (by_chat is the only index, so we check
// generationJobs.by_user_status instead) to count recent activity.
// This is intentionally simple: no token-bucket, no Redis, just a
// count of recent generation jobs per user in a sliding window.
// =============================================================================

import { QueryCtx, MutationCtx } from "../_generated/server";

const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_MESSAGES_PER_MINUTE = 30; // generous for normal usage, blocks abuse

/**
 * Throws if the user has exceeded the per-minute message rate limit.
 * Checks recent generationJobs (indexed by userId+status) as a proxy
 * for message send rate. This is O(1) with the by_user_status index.
 */
export async function assertRateLimit(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<void> {
  const cutoff = Date.now() - RATE_WINDOW_MS;

  // Count recent usage records (one per completed generation, indexed
  // on ["userId", "createdAt"]).
  const recentRecords = await ctx.db
    .query("usageRecords")
    .withIndex("by_user", (q) =>
      q.eq("userId", userId).gt("createdAt", cutoff),
    )
    .take(MAX_MESSAGES_PER_MINUTE + 1);

  if (recentRecords.length > MAX_MESSAGES_PER_MINUTE) {
    throw new Error(
      "Rate limit exceeded — please wait a moment before sending more messages.",
    );
  }
}
