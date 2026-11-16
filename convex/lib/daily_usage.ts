// convex/lib/daily_usage.ts
// =============================================================================
// Per-user, per-UTC-day counters for resources the platform pays for:
//   * `upload_bytes`        — bytes accepted by the client storage upload route
//   * `platform_embeddings` — memory embeddings computed with the platform's
//                             OpenAI key (users without an OpenRouter key)
// These are abuse ceilings, not product quotas: they sit far above normal use.
// =============================================================================

import type { MutationCtx, QueryCtx } from "../_generated/server";

export type DailyUsageKind = "upload_bytes" | "platform_embeddings";

export const DAILY_USAGE_LIMITS: Record<DailyUsageKind, number> = {
  upload_bytes: 1024 * 1024 * 1024,
  platform_embeddings: 2_000,
};

/** Counter rows older than this many days are pruned by the storage sweep. */
export const DAILY_USAGE_RETENTION_DAYS = 2;

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export async function dailyUsageAmount(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
  kind: DailyUsageKind,
  now = Date.now(),
): Promise<number> {
  const row = await ctx.db.query("userDailyUsage")
    .withIndex("by_user", (q) => q.eq("userId", userId).eq("kind", kind).eq("day", utcDay(now)))
    .first();
  return row?.amount ?? 0;
}

export function remainingDailyUsage(used: number, kind: DailyUsageKind): number {
  return Math.max(0, DAILY_USAGE_LIMITS[kind] - used);
}

/**
 * Adds `amount` to today's counter when the total stays within the limit.
 * Returns false (and records nothing) when it would exceed the limit.
 */
export async function tryConsumeDailyUsage(
  ctx: Pick<MutationCtx, "db">,
  userId: string,
  kind: DailyUsageKind,
  amount: number,
  now = Date.now(),
): Promise<boolean> {
  if (!Number.isFinite(amount) || amount < 0) return false;
  const day = utcDay(now);
  const row = await ctx.db.query("userDailyUsage")
    .withIndex("by_user", (q) => q.eq("userId", userId).eq("kind", kind).eq("day", day))
    .first();
  const used = row?.amount ?? 0;
  if (used + amount > DAILY_USAGE_LIMITS[kind]) return false;
  if (row) {
    await ctx.db.patch(row._id, { amount: used + amount, updatedAt: now });
  } else {
    await ctx.db.insert("userDailyUsage", { userId, kind, day, amount, updatedAt: now });
  }
  return true;
}

/** Deletes counter rows for days before the retention window. */
export async function pruneDailyUsage(
  ctx: Pick<MutationCtx, "db">,
  now: number,
  limit: number,
): Promise<number> {
  const cutoffDay = utcDay(now - DAILY_USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const rows = await ctx.db.query("userDailyUsage")
    .withIndex("by_day", (q) => q.lt("day", cutoffDay))
    .take(limit);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}
