// convex/favorites/queries.ts
// =============================================================================
// Favorites queries.
// =============================================================================

import { query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { optionalAuth } from "../lib/auth";

/** List all favorites for the authenticated user, ordered by sortOrder. */
export const listFavorites = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return [];

    const favorites = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", auth.userId))
      .collect();

    // Refresh persona avatar URLs from storage so clients never see expired
    // signed URLs. Favorites store a denormalized snapshot at creation time.
    const personaIds = new Set<string>();
    for (const f of favorites) {
      if (f.personaId) personaIds.add(f.personaId as string);
    }

    const personaAvatarUrls = new Map<string, string>();
    if (personaIds.size > 0) {
      await Promise.all(
        [...personaIds].map(async (pid) => {
          try {
            const persona = await ctx.db.get(pid as Id<"personas">);
            if (persona?.avatarImageStorageId) {
              const url = await ctx.storage.getUrl(persona.avatarImageStorageId);
              if (url) personaAvatarUrls.set(pid, url);
            }
          } catch {
            // Persona may have been deleted — keep the stale snapshot.
          }
        }),
      );
    }

    return favorites.map((f) => {
      if (f.personaId && personaAvatarUrls.has(f.personaId as string)) {
        return {
          ...f,
          personaAvatarImageUrl: personaAvatarUrls.get(f.personaId as string),
        };
      }
      return f;
    });
  },
});
