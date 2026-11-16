// convex/preferences/store_purchase_reverification.ts
// =============================================================================
// Daily re-verification of active App Store and Google Play entitlements.
//
// Refunds, revocations and voided purchases reach the server only through
// this check. Rows whose lastVerifiedAt is older than STALE_AFTER_MS are
// re-checked with the same store verifiers used at grant time, a bounded
// number of pages per store per run. Pro is removed only on a definitive store
// answer that the purchase is gone. Test purchases keep their grant, and
// retryable errors or missing configuration change nothing.
// =============================================================================

import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { internal } from "../_generated/api";
import { disableProClientState } from "./pro_client_state";
import {
  resolveAppStoreConfig,
  resolvePlayConfig,
  verifyAppStorePurchase,
  verifyPlayPurchase,
  type StoreVerification,
} from "./store_purchase_verification";

export const STALE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
export const PAGE_SIZE = 25;
export const MAX_PAGES_PER_STORE = 8;
/** Stop a store early after this many retryable errors (rate limit, outage). */
export const MAX_RETRYABLE_PER_STORE = 5;

export type StoreSource = "app_store" | "play_store";
export type ReverificationOutcome = "verified" | "refunded" | "revoked" | "skip";

export type StaleEntitlement = {
  _id: Id<"purchaseEntitlements">;
  externalPurchaseId: string;
  productId: string;
};

/** Maps a store answer to what the cron does with the entitlement. */
export function classifyReverification(result: StoreVerification): ReverificationOutcome {
  if (result.ok) return "verified";
  switch (result.reason) {
    case "test_purchase":
      return "verified"; // Existing tester grants stay; only the check time moves.
    case "revoked": // App Store revocationDate is set.
    case "not_purchased": // Play purchase cancelled or voided.
      return "refunded";
    case "transaction_not_found":
    case "token_not_found":
      return "revoked";
    default:
      return "skip";
  }
}

export type ReverificationCounts = {
  store: StoreSource;
  checked: number;
  verified: number;
  refunded: number;
  revoked: number;
  skipped: number;
  retryable: number;
  reasons: Record<string, number>;
  reachedPageLimit: boolean;
};

export async function reverifyStore(deps: {
  store: StoreSource;
  listPage: (cursor: string | null) => Promise<{ page: StaleEntitlement[]; continueCursor: string; isDone: boolean }>;
  verify: (row: StaleEntitlement) => Promise<StoreVerification>;
  apply: (row: StaleEntitlement, outcome: Exclude<ReverificationOutcome, "skip">) => Promise<void>;
}): Promise<ReverificationCounts> {
  const counts: ReverificationCounts = {
    store: deps.store, checked: 0, verified: 0, refunded: 0, revoked: 0, skipped: 0, retryable: 0,
    reasons: {}, reachedPageLimit: false,
  };
  let cursor: string | null = null;
  for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_STORE; pageIndex += 1) {
    const { page, continueCursor, isDone } = await deps.listPage(cursor);
    for (const row of page) {
      counts.checked += 1;
      const result: StoreVerification = await deps.verify(row).catch(() => ({
        ok: false as const, reason: "verification_error", retryable: true,
      }));
      if (!result.ok) counts.reasons[result.reason] = (counts.reasons[result.reason] ?? 0) + 1;
      if (!result.ok && result.retryable) {
        counts.retryable += 1;
        if (counts.retryable >= MAX_RETRYABLE_PER_STORE) return counts;
        continue;
      }
      const outcome = classifyReverification(result);
      if (outcome === "skip") {
        counts.skipped += 1;
        continue;
      }
      await deps.apply(row, outcome);
      counts[outcome] += 1;
    }
    if (isDone) return counts;
    cursor = continueCursor;
  }
  counts.reachedPageLimit = true;
  return counts;
}

export const listStaleStoreEntitlements = internalQuery({
  args: {
    source: v.union(v.literal("app_store"), v.literal("play_store")),
    staleBefore: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_source_status_verified", (q) =>
        q.eq("source", args.source).eq("status", "active").lt("lastVerifiedAt", args.staleBefore))
      .paginate({ cursor: args.cursor, numItems: PAGE_SIZE });
    return {
      page: result.page.map((row) => ({
        _id: row._id, externalPurchaseId: row.externalPurchaseId, productId: row.productId,
      })),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const applyStoreReverification = internalMutation({
  args: {
    entitlementId: v.id("purchaseEntitlements"),
    outcome: v.union(v.literal("verified"), v.literal("refunded"), v.literal("revoked")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entitlement = await ctx.db.get(args.entitlementId);
    // A client revocation may have landed while the store was being asked.
    if (!entitlement || entitlement.status !== "active") return null;
    const now = Date.now();
    if (args.outcome === "verified") {
      await ctx.db.patch(entitlement._id, { lastVerifiedAt: now, updatedAt: now });
      return null;
    }
    await ctx.db.patch(entitlement._id, {
      status: args.outcome, revokedAt: now, lastVerifiedAt: now, updatedAt: now,
    });
    const stillActive = await ctx.db
      .query("purchaseEntitlements")
      .withIndex("by_user_status", (q) => q.eq("userId", entitlement.userId).eq("status", "active"))
      .first();
    if (!stillActive) await disableProClientState(ctx, entitlement.userId, now);
    return null;
  },
});

/** Daily cron entry point. Logs counts only, never identifiers or tokens. */
export const reverifyStoreEntitlements = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const staleBefore = Date.now() - STALE_AFTER_MS;
    const appStore = resolveAppStoreConfig();
    const play = resolvePlayConfig();
    const stores: Array<{ store: StoreSource; verify: ((row: StaleEntitlement) => Promise<StoreVerification>) | null }> = [
      // Re-checks also ask the sandbox host, so an existing TestFlight grant is
      // found (and kept) rather than read as "not found" on production.
      { store: "app_store", verify: appStore ? (row) => verifyAppStorePurchase(row.externalPurchaseId, { ...appStore, acceptTest: true }) : null },
      { store: "play_store", verify: play ? (row) => verifyPlayPurchase(row.externalPurchaseId, row.productId, play) : null },
    ];
    for (const { store, verify } of stores) {
      if (!verify) {
        console.warn(`[entitlements] ${store} re-verification skipped: store credentials are not configured`);
        continue;
      }
      const counts = await reverifyStore({
        store,
        listPage: (cursor) => ctx.runQuery(internal.preferences.store_purchase_reverification.listStaleStoreEntitlements, {
          source: store, staleBefore, cursor,
        }),
        verify,
        apply: async (row, outcome) => {
          await ctx.runMutation(internal.preferences.store_purchase_reverification.applyStoreReverification, {
            entitlementId: row._id, outcome,
          });
        },
      });
      console.log("[entitlements] store re-verification", JSON.stringify(counts));
    }
    return null;
  },
});
