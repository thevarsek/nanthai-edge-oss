import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";

type EntitlementCtx = QueryCtx | MutationCtx;

type EntitlementStatus = Doc<"purchaseEntitlements">["status"];

const ACTIVE_STATUS: EntitlementStatus = "active";

export async function getActiveEntitlement(
  ctx: EntitlementCtx,
  userId: string,
): Promise<Doc<"purchaseEntitlements"> | null> {
  return await ctx.db
    .query("purchaseEntitlements")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", ACTIVE_STATUS),
    )
    .first();
}

export async function isUserPro(
  ctx: EntitlementCtx,
  userId: string,
): Promise<boolean> {
  const active = await getActiveEntitlement(ctx, userId);
  return active !== null;
}
