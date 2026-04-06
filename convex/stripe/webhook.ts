import { v } from "convex/values";
import { httpAction, internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  extractStripeEntitlementUpdate,
  type StripeEvent,
  verifyStripeSignature,
} from "./webhook_helpers";

type EntitlementStatus = "active" | "revoked" | "refunded" | "expired";

function entitlementMetadataMatches(
  metadata: unknown,
  paymentIntentId?: string,
  chargeId?: string,
): boolean {
  if (!metadata || typeof metadata !== "object") {
    return false;
  }
  const values = metadata as {
    paymentIntentId?: string;
    chargeId?: string;
  };
  return (
    (paymentIntentId != null && values.paymentIntentId === paymentIntentId) ||
    (chargeId != null && values.chargeId === chargeId)
  );
}

export const grantProEntitlement = internalMutation({
  args: {
    userId: v.string(),
    stripeSessionId: v.string(),
    paymentIntentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_external_purchase", (q) =>
        q.eq("externalPurchaseId", args.stripeSessionId),
      )
      .first();
    if (existing) return;

    const now = Date.now();
    await ctx.db.insert("purchaseEntitlements", {
      userId: args.userId,
      platform: "web",
      source: "stripe",
      productId: "nanthai_pro",
      externalPurchaseId: args.stripeSessionId,
      status: "active",
      activatedAt: now,
      lastVerifiedAt: now,
      metadata: {
        checkoutSessionId: args.stripeSessionId,
        paymentIntentId: args.paymentIntentId,
      },
      updatedAt: now,
    });
  },
});

export const updateStripeEntitlementStatus = internalMutation({
  args: {
    externalPurchaseIds: v.array(v.string()),
    paymentIntentId: v.optional(v.string()),
    chargeId: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("revoked"),
      v.literal("refunded"),
      v.literal("expired"),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const matches = new Map<string, { _id: any; userId: string }>();

    for (const externalPurchaseId of args.externalPurchaseIds) {
      const docs = await ctx.db
        .query("purchaseEntitlements")
        .withIndex("by_external_purchase", (q) =>
          q.eq("externalPurchaseId", externalPurchaseId),
        )
        .collect();
      for (const doc of docs) {
        if (doc.platform === "web" && doc.source === "stripe") {
          matches.set(doc._id, { _id: doc._id, userId: doc.userId });
        }
      }
    }

    if (matches.size === 0 && (args.paymentIntentId || args.chargeId)) {
      const docs = await ctx.db
        .query("purchaseEntitlements")
        .withIndex("by_platform_source", (q) =>
          q.eq("platform", "web").eq("source", "stripe"),
        )
        .collect();
      for (const doc of docs) {
        if (
          entitlementMetadataMatches(doc.metadata, args.paymentIntentId, args.chargeId)
        ) {
          matches.set(doc._id, { _id: doc._id, userId: doc.userId });
        }
      }
    }

    if (matches.size === 0) {
      return;
    }

    const affectedUserIds = new Set<string>();
    for (const match of matches.values()) {
      await ctx.db.patch(match._id, {
        status: args.status,
        revokedAt: args.status === "active" ? undefined : now,
        lastVerifiedAt: now,
        updatedAt: now,
      });
      affectedUserIds.add(match.userId);
    }

    for (const userId of affectedUserIds) {
      const stillActive = await ctx.db
        .query("purchaseEntitlements")
        .withIndex("by_user_status", (q) =>
          q.eq("userId", userId).eq("status", "active"),
        )
        .first();
      if (!stillActive) {
        await ctx.runMutation(
          internal.preferences.mutations.disableProClientStateInternal,
          { userId },
        );
      }
    }
  },
});

export const stripeWebhook = httpAction(async (ctx, request) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return new Response("Stripe webhook not configured", { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const isValid = await verifyStripeSignature(body, signature, webhookSecret);
  if (!isValid) {
    return new Response("Invalid signature", { status: 400 });
  }

  const event = JSON.parse(body) as StripeEvent;
  const update = extractStripeEntitlementUpdate(event);

  if (update?.kind === "grant") {
    await ctx.runMutation(internal.stripe.webhook.grantProEntitlement, {
      userId: update.userId,
      stripeSessionId: update.stripeSessionId,
      paymentIntentId: update.paymentIntentId,
    });
    await ctx.runMutation(
      internal.preferences.mutations.ensureUserPreferencesInternal,
      { userId: update.userId },
    );
  } else if (update?.kind === "revoke") {
    await ctx.runMutation(internal.stripe.webhook.updateStripeEntitlementStatus, {
      externalPurchaseIds: update.externalPurchaseIds,
      paymentIntentId: update.paymentIntentId,
      chargeId: update.chargeId,
      status: update.status as EntitlementStatus,
    });
  }

  return new Response("ok", { status: 200 });
});
