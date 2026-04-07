// convex/personas/mutations.ts
// =============================================================================
// Persona CRUD mutations.
//
// Personas are server-side copies of the iOS Persona model, synced up
// so the server can resolve system prompts and parameter overrides
// during generation without round-tripping to the client.
// =============================================================================

import { v, ConvexError } from "convex/values";
import { mutation, internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireAuth, requirePro } from "../lib/auth";
import { filterToolIncompatibleOptions } from "../lib/tool_capability";

/** Create a new persona. */
export const create = mutation({
  args: {
    displayName: v.string(),
    personaDescription: v.optional(v.string()),
    systemPrompt: v.string(),
    modelId: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    avatarEmoji: v.optional(v.string()),
    avatarImageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    avatarSFSymbol: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    // M10 Phase B — integration toggles (e.g. ["gmail", "drive", "calendar"])
    enabledIntegrations: v.optional(v.array(v.string())),
  },
  returns: v.id("personas"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const now = Date.now();

    // Silently strip integrations when the model doesn't support tools.
    const toolFilter = await filterToolIncompatibleOptions(ctx, {
      enabledIntegrations: args.enabledIntegrations,
      modelIds: [args.modelId],
    });
    const effectiveIntegrations = toolFilter.enabledIntegrations;

    // If marking as default, unset other defaults
    if (args.isDefault) {
      const existing = await ctx.db
        .query("personas")
        .withIndex("by_user_default", (q) =>
          q.eq("userId", userId).eq("isDefault", true),
        )
        .collect();
      for (const p of existing) {
        await ctx.db.patch(p._id, { isDefault: false, updatedAt: now });
      }
    }

    return await ctx.db.insert("personas", {
      userId,
      displayName: args.displayName,
      personaDescription: args.personaDescription,
      systemPrompt: args.systemPrompt,
      modelId: args.modelId,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      includeReasoning: args.includeReasoning,
      reasoningEffort: args.reasoningEffort,
      avatarEmoji: args.avatarEmoji,
      avatarImageStorageId: args.avatarImageStorageId ?? undefined,
      avatarSFSymbol: args.avatarSFSymbol,
      avatarColor: args.avatarColor,
      isDefault: args.isDefault ?? false,
      enabledIntegrations: effectiveIntegrations,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update an existing persona. */
export const update = mutation({
  args: {
    personaId: v.id("personas"),
    displayName: v.optional(v.string()),
    personaDescription: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    modelId: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    avatarEmoji: v.optional(v.string()),
    avatarImageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    avatarSFSymbol: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    // M10 Phase B — integration toggles (e.g. ["gmail", "drive", "calendar"])
    enabledIntegrations: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const persona = await ctx.db.get(args.personaId);
    if (!persona || persona.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Persona not found or unauthorized" });
    }

    const now = Date.now();
    const effectiveModelId = args.modelId ?? persona.modelId;
    const requestedIntegrations =
      args.enabledIntegrations ?? persona.enabledIntegrations;

    // Silently strip integrations when the model doesn't support tools.
    const toolFilter = await filterToolIncompatibleOptions(ctx, {
      enabledIntegrations: requestedIntegrations,
      modelIds: [effectiveModelId],
    });
    const filteredIntegrations = toolFilter.enabledIntegrations;

    // If marking as default, unset other defaults
    if (args.isDefault) {
      const existing = await ctx.db
        .query("personas")
        .withIndex("by_user_default", (q) =>
          q.eq("userId", userId).eq("isDefault", true),
        )
        .collect();
      for (const p of existing) {
        if (p._id !== args.personaId) {
          await ctx.db.patch(p._id, { isDefault: false, updatedAt: now });
        }
      }
    }

    const { personaId, avatarImageStorageId, ...updates } = args;
    const previousAvatarStorageId = persona.avatarImageStorageId as Id<"_storage"> | undefined;
    const nextAvatarStorageId =
      avatarImageStorageId === null ? undefined : (avatarImageStorageId ?? previousAvatarStorageId);

    await ctx.db.patch(personaId, {
      ...updates,
      enabledIntegrations: filteredIntegrations,
      avatarImageStorageId: nextAvatarStorageId,
      updatedAt: now,
    });

    if (previousAvatarStorageId && previousAvatarStorageId !== nextAvatarStorageId) {
      await ctx.storage.delete(previousAvatarStorageId);
    }
  },
});

/** Delete a persona. */
export const remove = mutation({
  args: { personaId: v.id("personas") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const persona = await ctx.db.get(args.personaId);
    if (!persona || persona.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Persona not found or unauthorized" });
    }
    if (persona.avatarImageStorageId) {
      await ctx.storage.delete(persona.avatarImageStorageId);
    }
    await ctx.db.delete(args.personaId);
  },
});

// ── Internal mutations (for AI tools running in ActionCtx) ─────────────

/** Internal: create a persona on behalf of a user (no auth context needed). */
export const createPersonaInternal = internalMutation({
  args: {
    userId: v.string(),
    displayName: v.string(),
    personaDescription: v.optional(v.string()),
    systemPrompt: v.string(),
    modelId: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    avatarEmoji: v.optional(v.string()),
    avatarImageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    avatarColor: v.optional(v.string()),
    enabledIntegrations: v.optional(v.array(v.string())),
  },
  returns: v.id("personas"),
  handler: async (ctx, args) => {
    const now = Date.now();

    // Silently strip integrations when the model doesn't support tools.
    const toolFilter = await filterToolIncompatibleOptions(ctx, {
      enabledIntegrations: args.enabledIntegrations,
      modelIds: [args.modelId],
    });

    return await ctx.db.insert("personas", {
      userId: args.userId,
      displayName: args.displayName,
      personaDescription: args.personaDescription,
      systemPrompt: args.systemPrompt,
      modelId: args.modelId,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      avatarEmoji: args.avatarEmoji,
      avatarImageStorageId: args.avatarImageStorageId ?? undefined,
      avatarColor: args.avatarColor,
      isDefault: false,
      enabledIntegrations: toolFilter.enabledIntegrations,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Internal: delete a persona on behalf of a user (no auth context needed). */
export const removePersonaInternal = internalMutation({
  args: {
    personaId: v.id("personas"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const persona = await ctx.db.get(args.personaId);
    if (!persona || persona.userId !== args.userId) {
      throw new Error("Persona not found or unauthorized");
    }
    if (persona.avatarImageStorageId) {
      await ctx.storage.delete(persona.avatarImageStorageId);
    }
    await ctx.db.delete(args.personaId);
  },
});
