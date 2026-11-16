// convex/security/account_access_revocation.ts
// Revokes every credential and standing authority NanthAI issued to one
// account. Each call handles a bounded page per kind; the caller schedules a
// follow-up until `done`. Revocation is permanent: unblocking does not restore.

import type { MutationCtx } from "../_generated/server";
import { revokeDeviceHandler } from "../runtime_host/pairing";
import { revokeIdentity } from "../channels/linking_helpers";

const PAGE = 50;
const DEVICE_PAGE = 10;

export type AccountRevocationCounts = {
  externalMcpGrants: number;
  externalMcpAuthorizations: number;
  runtimeDevices: number;
  runtimePairingRequests: number;
  triggerTokens: number;
  scheduledJobs: number;
  channelIdentities: number;
  channelLinkGrants: number;
  deviceTokens: number;
};

export async function revokeAccountCredentialsPage(
  ctx: MutationCtx,
  userId: string,
  reason: string,
): Promise<{ done: boolean; counts: AccountRevocationCounts }> {
  const now = Date.now();
  let done = true;
  const page = <T>(rows: T[], size = PAGE): T[] => {
    if (rows.length >= size) done = false;
    return rows;
  };

  const grants = page(await ctx.db.query("externalMcpGrants").withIndex("by_user", q => q.eq("userId", userId))
    .filter(q => q.eq(q.field("revokedAt"), undefined)).take(PAGE));
  for (const grant of grants) if (grant.revokedAt === undefined) await ctx.db.patch(grant._id, { revokedAt: now });

  const authorizations = page(await ctx.db.query("externalMcpAuthorizations").withIndex("by_user", q => q.eq("userId", userId))
    .filter(q => q.eq(q.field("consumedAt"), undefined)).take(PAGE));
  for (const pending of authorizations) if (pending.consumedAt === undefined) await ctx.db.patch(pending._id, { consumedAt: now });

  const devices = page(await ctx.db.query("runtimeDevices")
    .withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active")).take(DEVICE_PAGE), DEVICE_PAGE);
  for (const device of devices) {
    await revokeDeviceHandler(ctx, { userId, runtimeDeviceId: device._id, reason, now });
  }

  const pairings = page(await ctx.db.query("runtimePairingRequests").withIndex("by_user", q => q.eq("userId", userId))
    .filter(q => q.eq(q.field("status"), "pending")).take(PAGE));
  for (const pairing of pairings) {
    if (pairing.status === "pending") await ctx.db.patch(pairing._id, { status: "cancelled", updatedAt: now });
  }

  const tokens = page(await ctx.db.query("scheduledJobTriggerTokens")
    .withIndex("by_user", q => q.eq("userId", userId).eq("status", "active")).take(PAGE));
  for (const token of tokens) await ctx.db.patch(token._id, { status: "revoked", revokedAt: now, updatedAt: now });

  const jobs = page(await ctx.db.query("scheduledJobs").withIndex("by_user", q => q.eq("userId", userId))
    .filter(q => q.neq(q.field("status"), "paused")).take(PAGE));
  for (const job of jobs) {
    if (job.status === "paused") continue;
    if (job.scheduledFunctionId) {
      try { await ctx.scheduler.cancel(job.scheduledFunctionId); } catch { /* already ran or cancelled */ }
    }
    await ctx.db.patch(job._id, { status: "paused", nextRunAt: undefined, scheduledFunctionId: undefined, updatedAt: now });
  }

  const identities = page(await ctx.db.query("channelIdentities").withIndex("by_user", q => q.eq("userId", userId))
    .filter(q => q.eq(q.field("active"), true)).take(DEVICE_PAGE), DEVICE_PAGE);
  for (const identity of identities) if (identity.active) await revokeIdentity(ctx, identity);

  const linkGrants = page(await ctx.db.query("channelLinkGrants").withIndex("by_user", q => q.eq("userId", userId))
    .filter(q => q.or(q.eq(q.field("status"), "pending"), q.eq(q.field("status"), "claimed"))).take(PAGE));
  for (const grant of linkGrants) {
    if (grant.status === "pending" || grant.status === "claimed") await ctx.db.patch(grant._id, { status: "revoked" });
  }

  const pushTokens = page(await ctx.db.query("deviceTokens").withIndex("by_user", q => q.eq("userId", userId)).take(PAGE));
  for (const pushToken of pushTokens) await ctx.db.delete(pushToken._id);

  return {
    done,
    counts: {
      externalMcpGrants: grants.length,
      externalMcpAuthorizations: authorizations.length,
      runtimeDevices: devices.length,
      runtimePairingRequests: pairings.length,
      triggerTokens: tokens.length,
      scheduledJobs: jobs.length,
      channelIdentities: identities.length,
      channelLinkGrants: linkGrants.length,
      deviceTokens: pushTokens.length,
    },
  };
}
