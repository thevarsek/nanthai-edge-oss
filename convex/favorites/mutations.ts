// convex/favorites/mutations.ts
// =============================================================================
// Favorites CRUD mutations.
//
// A "favorite" is a quick-launch shortcut: a single model, a persona, or a
// group of up to 3 models. Tapping a favorite auto-creates a new chat with
// those participants pre-selected.
// =============================================================================

import { ConvexError, v } from "convex/values";
import { mutation } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { validateSameModality } from "../lib/modality_utils";
import { favoriteParticipant } from "../schema_validators";

const MAX_MODELS_PER_FAVORITE = 3;
const MAX_FAVORITES_PER_USER = 20;

/** Create a new favorite. */
export const createFavorite = mutation({
  args: {
    name: v.string(),
    modelIds: v.optional(v.array(v.string())),
    participants: v.optional(v.array(favoriteParticipant)),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
  },
  returns: v.id("favorites"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();
    const participants = normalizeFavoriteParticipants(args);
    const modelIds = participants.map((participant) => participant.modelId);
    const legacyPersona = legacyPersonaSnapshot(participants);

    if (participants.length === 0) {
      throw new ConvexError({ code: "INVALID_ARGS", message: "At least one model is required." });
    }
    if (participants.length > MAX_MODELS_PER_FAVORITE) {
      throw new ConvexError({
        code: "INVALID_ARGS",
        message: `A favorite can have at most ${MAX_MODELS_PER_FAVORITE} models.`,
      });
    }

    // Count existing favorites to enforce cap.
    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (existing.length >= MAX_FAVORITES_PER_USER) {
      throw new ConvexError({
        code: "LIMIT_REACHED",
        message: `You can have at most ${MAX_FAVORITES_PER_USER} favorites.`,
      });
    }

    // M29: Enforce same-modality constraint (text/image/video cannot be mixed).
    if (modelIds.length > 1) {
      try {
        await validateSameModality(ctx, modelIds);
      } catch (e: unknown) {
        throw new ConvexError({
          code: "INVALID_ARGS",
          message: e instanceof Error ? e.message : "Models must share the same output modality.",
        });
      }
    }

    // New favorite goes to the end.
    const maxOrder = existing.reduce((max, f) => Math.max(max, f.sortOrder), -1);

    return await ctx.db.insert("favorites", {
      userId,
      name: args.name.trim(),
      modelIds,
      participants,
      personaId: legacyPersona?.personaId,
      personaName: legacyPersona?.personaName,
      personaEmoji: legacyPersona?.personaEmoji,
      personaAvatarImageUrl: legacyPersona?.personaAvatarImageUrl,
      sortOrder: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update a favorite's name, models, or persona. */
export const updateFavorite = mutation({
  args: {
    favoriteId: v.id("favorites"),
    name: v.optional(v.string()),
    modelIds: v.optional(v.array(v.string())),
    participants: v.optional(v.array(favoriteParticipant)),
    personaId: v.optional(v.union(v.id("personas"), v.null())),
    personaName: v.optional(v.union(v.string(), v.null())),
    personaEmoji: v.optional(v.union(v.string(), v.null())),
    personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const favorite = await ctx.db.get(args.favoriteId);
    if (!favorite || favorite.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Favorite not found." });
    }

    const participants = args.participants !== undefined
      ? normalizeFavoriteParticipants({ participants: args.participants })
      : args.modelIds !== undefined
        ? normalizeFavoriteParticipants({
            modelIds: args.modelIds,
            personaId: args.personaId === null ? undefined : args.personaId,
            personaName: args.personaName === null ? undefined : args.personaName,
            personaEmoji: args.personaEmoji === null ? undefined : args.personaEmoji,
            personaAvatarImageUrl:
              args.personaAvatarImageUrl === null ? undefined : args.personaAvatarImageUrl,
          })
        : undefined;

    if (participants !== undefined) {
      if (participants.length === 0) {
        throw new ConvexError({ code: "INVALID_ARGS", message: "At least one model is required." });
      }
      if (participants.length > MAX_MODELS_PER_FAVORITE) {
        throw new ConvexError({
          code: "INVALID_ARGS",
          message: `A favorite can have at most ${MAX_MODELS_PER_FAVORITE} models.`,
        });
      }

      // M29: Enforce same-modality constraint on update.
      if (participants.length > 1) {
        try {
          await validateSameModality(ctx, participants.map((participant) => participant.modelId));
        } catch (e: unknown) {
          throw new ConvexError({
            code: "INVALID_ARGS",
            message: e instanceof Error ? e.message : "Models must share the same output modality.",
          });
        }
      }
    }

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.name !== undefined) patch.name = args.name.trim();
    if (participants !== undefined) {
      patch.modelIds = participants.map((participant) => participant.modelId);
      patch.participants = participants;
      const legacyPersona = legacyPersonaSnapshot(participants);
      patch.personaId = legacyPersona?.personaId;
      patch.personaName = legacyPersona?.personaName;
      patch.personaEmoji = legacyPersona?.personaEmoji;
      patch.personaAvatarImageUrl = legacyPersona?.personaAvatarImageUrl;
    } else {
      if (args.personaId !== undefined) patch.personaId = args.personaId === null ? undefined : args.personaId;
      if (args.personaName !== undefined) patch.personaName = args.personaName === null ? undefined : args.personaName;
      if (args.personaEmoji !== undefined) patch.personaEmoji = args.personaEmoji === null ? undefined : args.personaEmoji;
      if (args.personaAvatarImageUrl !== undefined) {
        patch.personaAvatarImageUrl = args.personaAvatarImageUrl === null ? undefined : args.personaAvatarImageUrl;
      }
    }

    await ctx.db.patch(args.favoriteId, patch);
  },
});

type FavoriteParticipantInput = {
  modelId: string;
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
};

type LegacyFavoriteArgs = {
  modelIds?: string[];
  participants?: FavoriteParticipantInput[];
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
};

function normalizeFavoriteParticipants(args: LegacyFavoriteArgs): FavoriteParticipantInput[] {
  if (args.participants !== undefined) {
    return args.participants
      .map((participant) => ({
        ...participant,
        modelId: participant.modelId.trim(),
      }))
      .filter((participant) => participant.modelId.length > 0);
  }

  return (args.modelIds ?? [])
    .map((modelId, index) => {
      const trimmedModelId = modelId.trim();
      if (index === 0 && args.personaId) {
        return {
          modelId: trimmedModelId,
          personaId: args.personaId,
          personaName: args.personaName,
          personaEmoji: args.personaEmoji,
          personaAvatarImageUrl: args.personaAvatarImageUrl,
        };
      }
      return { modelId: trimmedModelId };
    })
    .filter((participant) => participant.modelId.length > 0);
}

function legacyPersonaSnapshot(participants: FavoriteParticipantInput[]) {
  return participants.find((participant) => participant.personaId);
}

/** Delete a favorite. */
export const deleteFavorite = mutation({
  args: {
    favoriteId: v.id("favorites"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const favorite = await ctx.db.get(args.favoriteId);
    if (!favorite || favorite.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Favorite not found." });
    }

    await ctx.db.delete(args.favoriteId);
  },
});

/** Reorder favorites. Accepts the full ordered list of favorite IDs. */
export const reorderFavorites = mutation({
  args: {
    orderedIds: v.array(v.id("favorites")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();

    const existing = await ctx.db
      .query("favorites")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    if (args.orderedIds.length !== existing.length) {
      throw new ConvexError({
        code: "INVALID_ARGS",
        message: "Favorites reorder requires the full ordered list.",
      });
    }

    const seen = new Set<string>();
    for (const favoriteId of args.orderedIds) {
      const id = String(favoriteId);
      if (seen.has(id)) {
        throw new ConvexError({
          code: "INVALID_ARGS",
          message: "Favorites reorder cannot contain duplicate IDs.",
        });
      }
      seen.add(id);
    }

    for (let i = 0; i < args.orderedIds.length; i++) {
      const favorite = await ctx.db.get(args.orderedIds[i]);
      if (!favorite || favorite.userId !== userId) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Favorite not found." });
      }
      if (favorite.sortOrder !== i) {
        await ctx.db.patch(args.orderedIds[i], { sortOrder: i, updatedAt: now });
      }
    }
  },
});
