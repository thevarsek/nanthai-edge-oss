// convex/preferences/store_purchase_actions.ts
// One-shot verification actions scheduled by syncEntitlement /
// syncPlayEntitlement. A purchase becomes an active entitlement only after the
// store confirms it. Clients re-sync on launch, so a transient store failure is
// retried by the next sync rather than by a scheduler chain. A definitive
// rejection marks the sync attempt so the same identifier is not re-checked
// for a short time (store_verification_admission.ts).
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { upsertPurchaseEntitlement } from "./purchase_entitlement_upsert";
import {
  resolveAppStoreConfig,
  resolvePlayConfig,
  verifyAppStorePurchase,
  verifyPlayPurchase,
  type StoreVerification,
} from "./store_purchase_verification";

async function recordRejection(
  ctx: ActionCtx,
  store: string,
  userId: string,
  result: StoreVerification,
  attemptId: Id<"storeVerificationAttempts"> | undefined,
): Promise<void> {
  if (result.ok) return;
  console.warn(`[entitlements] ${store} purchase not granted for ${userId}: ${result.reason}${result.retryable ? " (retryable)" : ""}`);
  if (!result.retryable && attemptId) {
    await ctx.runMutation(internal.preferences.store_verification_admission.markStoreVerificationRejected, { attemptId });
  }
}

export const verifyAppStoreEntitlement = internalAction({
  args: {
    userId: v.string(),
    transactionId: v.string(),
    attemptId: v.optional(v.id("storeVerificationAttempts")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const config = resolveAppStoreConfig();
    if (!config) {
      console.error("[entitlements] Missing APP_STORE_IAP_* / APP_STORE_BUNDLE_ID env vars; App Store purchase not verified");
      return null;
    }
    const result = await verifyAppStorePurchase(args.transactionId, config);
    if (!result.ok) {
      await recordRejection(ctx, "App Store", args.userId, result, args.attemptId);
      return null;
    }
    await ctx.runMutation(internal.preferences.store_purchase_actions.recordVerifiedStoreEntitlement, {
      userId: args.userId,
      platform: "ios",
      productId: result.productId,
      externalPurchaseId: result.externalPurchaseId,
      environment: result.environment,
    });
    return null;
  },
});

export const verifyPlayEntitlement = internalAction({
  args: {
    userId: v.string(),
    purchaseToken: v.string(),
    productId: v.string(),
    attemptId: v.optional(v.id("storeVerificationAttempts")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const config = resolvePlayConfig();
    if (!config) {
      console.error("[entitlements] Missing PLAY_* env vars; Play purchase not verified");
      return null;
    }
    const result = await verifyPlayPurchase(args.purchaseToken, args.productId, config);
    if (!result.ok) {
      await recordRejection(ctx, "Play", args.userId, result, args.attemptId);
      return null;
    }
    await ctx.runMutation(internal.preferences.store_purchase_actions.recordVerifiedStoreEntitlement, {
      userId: args.userId,
      platform: "android",
      productId: result.productId,
      externalPurchaseId: result.externalPurchaseId,
      environment: result.environment,
      packageName: config.packageName,
    });
    return null;
  },
});

export const recordVerifiedStoreEntitlement = internalMutation({
  args: {
    userId: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    productId: v.string(),
    externalPurchaseId: v.string(),
    environment: v.string(),
    packageName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertPurchaseEntitlement(ctx, {
      userId: args.userId,
      externalPurchaseId: args.externalPurchaseId,
      productId: args.productId,
      platform: args.platform,
      source: args.platform === "ios" ? "app_store" : "play_store",
      rawEnvironment: args.environment,
      metadata: args.packageName ? { packageName: args.packageName } : undefined,
      now: Date.now(),
      status: "active",
    });
    return null;
  },
});
