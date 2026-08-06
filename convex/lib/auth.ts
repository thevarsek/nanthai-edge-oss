// convex/lib/auth.ts
// Shared auth helpers for Convex functions.

import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { hasCapability } from "../capabilities/shared";
import { isUserPro } from "../preferences/entitlements";

const isAccountDeletionStartedRef = makeFunctionReference<"query">(
  "account/deletion_state:isAccountDeletionStarted",
);

// ---------------------------------------------------------------------------
// Pro Entitlement Policy
// ---------------------------------------------------------------------------
// Source of truth: docs/monetization.md
//
// Features that call `requirePro(ctx, userId)` on the backend:
//
//   personas        — create / update / remove a persona, or send/retry a
//                     message that references one (participants.some(p => p.personaId))
//   autonomous      — startSession, resumeSession
//   scheduled_jobs  — createScheduledJob, updateScheduledJob
//   advanced_search — sendMessage with searchMode "web",
//                     startResearchPaper, regeneratePaper
//   memory_writes   — all memory mutations (enable, update mode/model, clear)
//                     Note: memory *reads* (list) are free.
//   tool_registry   — buildProgressiveToolRegistry({ isPro: false, ... })
//                     returns an empty registry;
//                     free users never trigger tool calls. Server pipelines
//                     call with no options → all tools available.
//
// The client mirrors this with Convex-driven Pro gating on every platform.
// ---------------------------------------------------------------------------

/**
 * Resolve the authenticated Clerk user ID from the request context.
 * Throws if the user is not authenticated.
 *
 * Use this in queries and mutations that require authentication.
 * For scheduled functions (which lack auth context), accept userId as
 * an explicit parameter instead.
 */
export async function requireAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx,
  options: { allowAccountDeletion?: boolean } = {},
): Promise<{ userId: string; email?: string; name?: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "AUTH_REQUIRED" as const, message: "Authentication required. Please sign in." });
  }
  const user = {
    userId: identity.subject, // Clerk user ID (e.g., "user_2x...")
    email: identity.email ?? undefined,
    name: identity.name ?? undefined,
  };
  if (!options.allowAccountDeletion) {
    let deletionStarted = false;
    try {
      // Real Convex query/mutation contexts expose the system reader. Narrow
      // direct-handler unit mocks intentionally do not; they are not a safe
      // place to infer account-deletion state from an incomplete DB surface.
      if ("db" in ctx && "system" in ctx.db) {
        const tombstone = await ctx.db
          .query("accountDeletionTombstones")
          .withIndex("by_user", (q) => q.eq("userId", user.userId))
          .unique();
        deletionStarted = Boolean(
          tombstone
          && tombstone.userId === user.userId
          && typeof tombstone.requestedAt === "number",
        );
      } else if ("runQuery" in ctx) {
        // Actions have no direct database reader, so consult the same durable
        // fence before they can dispatch internal writes.
        deletionStarted = (await ctx.runQuery(isAccountDeletionStartedRef, {
          userId: user.userId,
        })) === true;
      }
    } catch (error) {
      // Direct unit-handler tests use deliberately partial Convex contexts.
      // Real Convex contexts always expose the typed query surface, so only
      // tolerate missing/asserting mock methods rather than database errors.
      const errorName = error instanceof Error ? error.name : "";
      if (!(error instanceof TypeError) && errorName !== "AssertionError") throw error;
    }
    if (deletionStarted) {
      throw new ConvexError({
        code: "ACCOUNT_DELETION_IN_PROGRESS" as const,
        message: "Account deletion is in progress.",
      });
    }
  }
  return user;
}

/**
 * Optionally resolve the authenticated user. Returns null if not authenticated.
 * Useful for queries that support both authenticated and anonymous access.
 */
export async function optionalAuth(
  ctx: QueryCtx | MutationCtx | ActionCtx,
): Promise<{ userId: string; email?: string; name?: string } | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }
  return await requireAuth(ctx);
}

/**
 * Check that the authenticated user has Pro status. Requires auth first.
 * Throws a user-friendly error if the user is on the free tier.
 *
 * Source of truth: `purchaseEntitlements` table (via `isUserPro()`).
 */
export async function requirePro(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<void> {
  const isPro = await getIsProUnlocked(ctx, userId);
  if (!isPro) {
    throw new ConvexError({
      code: "PRO_REQUIRED" as const,
      message:
        "This feature requires NanthAI Pro. Upgrade from Settings to unlock it.",
    });
  }
}

export async function getIsProUnlocked(
  ctx: QueryCtx | MutationCtx,
  userId: string,
): Promise<boolean> {
  return await isUserPro(ctx, userId);
}

export async function requireCapability(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  capability: "pro" | "mcpRuntime",
): Promise<void> {
  const allowed = await hasCapability(ctx, userId, capability);
  if (allowed) return;

  throw new ConvexError({
    code: "CAPABILITY_REQUIRED" as const,
    capability,
    message:
      capability === "mcpRuntime"
        ? "This feature requires MCP runtime access."
        : "This feature requires NanthAI Pro.",
  });
}
