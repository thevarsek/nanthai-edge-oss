// convex/personas/queries.ts
// =============================================================================
// Persona queries: list, get, get default.
// =============================================================================

import { v } from "convex/values";
import { query, internalQuery } from "../_generated/server";
import { optionalAuth } from "../lib/auth";

async function withAvatarUrl<T extends { avatarImageStorageId?: string }>(
  ctx: { storage: { getUrl: (storageId: any) => Promise<string | null> } },
  persona: T,
): Promise<T & { avatarImageUrl?: string }> {
  if (!persona.avatarImageStorageId) {
    return { ...persona, avatarImageUrl: undefined };
  }
  const avatarImageUrl = await ctx.storage.getUrl(persona.avatarImageStorageId);
  return { ...persona, avatarImageUrl: avatarImageUrl ?? undefined };
}

/** List all personas for the authenticated user. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return [];
    const personas = await ctx.db
      .query("personas")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .collect();
    return await Promise.all(personas.map((persona) => withAvatarUrl(ctx, persona)));
  },
});

/** Get a single persona by ID. */
export const get = query({
  args: { personaId: v.id("personas") },
  handler: async (ctx, args) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return null;
    const persona = await ctx.db.get(args.personaId);
    if (!persona || persona.userId !== auth.userId) return null;
    return await withAvatarUrl(ctx, persona);
  },
});

/** Get the user's default persona (if any). */
export const getDefault = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return null;
    const result = await ctx.db
      .query("personas")
      .withIndex("by_user_default", (q) =>
        q.eq("userId", auth.userId).eq("isDefault", true),
      )
      .first();
    if (!result) return null;
    return await withAvatarUrl(ctx, result);
  },
});

// ── Internal queries (for AI tools running in ActionCtx) ───────────────

/** Internal: list all personas for a user (no auth context needed). */
export const listPersonasInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const personas = await ctx.db
      .query("personas")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return await Promise.all(personas.map((persona) => withAvatarUrl(ctx, persona)));
  },
});
