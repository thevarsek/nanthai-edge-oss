// convex/preferences/purchase_entitlement_upsert.ts
// Writes a store purchase entitlement row, enforcing one account per purchase.
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

export async function upsertPurchaseEntitlement(
  ctx: MutationCtx,
  args: {
    userId: string;
    externalPurchaseId: string;
    productId: string;
    platform: "ios" | "android";
    source: "app_store" | "play_store";
    rawEnvironment?: string;
    metadata?: Record<string, unknown>;
    now: number;
    status: "active" | "revoked" | "refunded" | "expired";
  },
): Promise<void> {
  const matches = await ctx.db
    .query("purchaseEntitlements")
    .withIndex("by_external_purchase", (q) =>
      q.eq("externalPurchaseId", args.externalPurchaseId),
    )
    .collect();

  const canonical = matches[0] ?? null;
  const duplicates = matches.slice(1);

  if (canonical && canonical.userId !== args.userId) {
    throw new ConvexError({
      code: "ENTITLEMENT_USER_MISMATCH" as const,
      message: "This purchase is already linked to a different account.",
    });
  }

  for (const duplicate of duplicates) {
    if (duplicate.userId !== args.userId) {
      throw new ConvexError({
        code: "ENTITLEMENT_USER_MISMATCH" as const,
        message: "This purchase is already linked to a different account.",
      });
    }
  }

  if (canonical) {
    await ctx.db.patch(canonical._id, {
      platform: args.platform,
      source: args.source,
      productId: args.productId,
      externalPurchaseId: args.externalPurchaseId,
      status: args.status,
      activatedAt: canonical.activatedAt,
      revokedAt: args.status === "active" ? undefined : args.now,
      lastVerifiedAt: args.now,
      rawEnvironment: args.rawEnvironment,
      metadata: args.metadata,
      updatedAt: args.now,
    });

    for (const duplicate of duplicates) {
      await ctx.db.delete(duplicate._id);
    }
    return;
  }

  await ctx.db.insert("purchaseEntitlements", {
    userId: args.userId,
    platform: args.platform,
    source: args.source,
    productId: args.productId,
    externalPurchaseId: args.externalPurchaseId,
    status: args.status,
    activatedAt: args.now,
    revokedAt: args.status === "active" ? undefined : args.now,
    lastVerifiedAt: args.now,
    rawEnvironment: args.rawEnvironment,
    metadata: args.metadata,
    updatedAt: args.now,
  });
}

/**
 * True when this user already holds an active entitlement for the purchase.
 * Throws ENTITLEMENT_USER_MISMATCH when another account owns it.
 */
export async function hasActiveEntitlementForPurchase(
  ctx: MutationCtx,
  userId: string,
  externalPurchaseId: string,
): Promise<boolean> {
  const matches = await ctx.db
    .query("purchaseEntitlements")
    .withIndex("by_external_purchase", (q) => q.eq("externalPurchaseId", externalPurchaseId))
    .collect();
  if (matches.some((match) => match.userId !== userId)) {
    throw new ConvexError({
      code: "ENTITLEMENT_USER_MISMATCH" as const,
      message: "This purchase is already linked to a different account.",
    });
  }
  return matches.some((match) => match.status === "active");
}
