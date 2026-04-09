// convex/lib/auth.ts
// Shared auth helpers for Convex functions.

import { QueryCtx, MutationCtx, ActionCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { hasCapability } from "../capabilities/shared";
import { isUserPro } from "../preferences/entitlements";

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
//   tool_registry   — buildToolRegistry(isPro:false) returns empty registry;
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
): Promise<{ userId: string; email?: string; name?: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ code: "AUTH_REQUIRED" as const, message: "Authentication required. Please sign in." });
  }
  return {
    userId: identity.subject, // Clerk user ID (e.g., "user_2x...")
    email: identity.email ?? undefined,
    name: identity.name ?? undefined,
  };
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
  return {
    userId: identity.subject,
    email: identity.email ?? undefined,
    name: identity.name ?? undefined,
  };
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
