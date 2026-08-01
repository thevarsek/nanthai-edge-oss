// convex/personas/mutations.ts
// =============================================================================
// Persona CRUD mutations.
//
// Personas are server-side copies of the iOS Persona model, synced up
// so the server can resolve system prompts and parameter overrides
// during generation without round-tripping to the client.
// =============================================================================

import { v, ConvexError } from "convex/values";
import { mutation, internalMutation, type MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireAuth, requirePro } from "../lib/auth";
import { skillOverrideEntry, integrationOverrideEntry } from "../schema_validators";
import { unknownOwnedRemoteMcpIntegrationIds } from "../mcp/integration_targets";

async function assertOwnedRemoteMcpTargets(
  ctx: MutationCtx,
  userId: string,
  overrides: Array<{ integrationId: string }> | undefined,
): Promise<void> {
  const unknown = await unknownOwnedRemoteMcpIntegrationIds(
    ctx,
    userId,
    overrides?.map((override) => override.integrationId) ?? [],
  );
  if (unknown.length > 0) {
    throw new ConvexError({
      code: "UNKNOWN_INTEGRATIONS",
      message: `Unknown Remote MCP server targets: ${unknown.join(", ")}.`,
    });
  }
}

/** Create a new persona. */
export const create = mutation({
  args: {
    displayName: v.string(),
    personaDescription: v.optional(v.union(v.string(), v.null())),
    systemPrompt: v.string(),
    modelId: v.optional(v.string()),
    temperature: v.optional(v.union(v.number(), v.null())),
    maxTokens: v.optional(v.union(v.number(), v.null())),
    includeReasoning: v.optional(v.union(v.boolean(), v.null())),
    reasoningEffort: v.optional(v.union(v.string(), v.null())),
    avatarEmoji: v.optional(v.union(v.string(), v.null())),
    avatarImageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    avatarSFSymbol: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    // Legacy compatibility only. Persona integration state now lives in
    // `integrationOverrides` via `skills/mutations:setPersonaIntegrationOverrides`.
    enabledIntegrations: v.optional(v.array(v.string())),
    skillOverrides: v.optional(v.array(skillOverrideEntry)),
    integrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  },
  returns: v.id("personas"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    await assertOwnedRemoteMcpTargets(ctx, userId, args.integrationOverrides);
    const now = Date.now();

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
      personaDescription: args.personaDescription ?? undefined,
      systemPrompt: args.systemPrompt,
      modelId: args.modelId,
      temperature: args.temperature ?? undefined,
      maxTokens: args.maxTokens ?? undefined,
      includeReasoning: args.includeReasoning ?? undefined,
      reasoningEffort: args.reasoningEffort ?? undefined,
      avatarEmoji: args.avatarEmoji ?? undefined,
      avatarImageStorageId: args.avatarImageStorageId ?? undefined,
      avatarSFSymbol: args.avatarSFSymbol,
      avatarColor: args.avatarColor,
      skillOverrides: args.skillOverrides,
      integrationOverrides: args.integrationOverrides,
      isDefault: args.isDefault ?? false,
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
    personaDescription: v.optional(v.union(v.string(), v.null())),
    systemPrompt: v.optional(v.string()),
    modelId: v.optional(v.string()),
    temperature: v.optional(v.union(v.number(), v.null())),
    maxTokens: v.optional(v.union(v.number(), v.null())),
    includeReasoning: v.optional(v.union(v.boolean(), v.null())),
    reasoningEffort: v.optional(v.union(v.string(), v.null())),
    avatarEmoji: v.optional(v.union(v.string(), v.null())),
    avatarImageStorageId: v.optional(v.union(v.id("_storage"), v.null())),
    avatarSFSymbol: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    // Legacy compatibility only. Persona integration state now lives in
    // `integrationOverrides` via `skills/mutations:setPersonaIntegrationOverrides`.
    enabledIntegrations: v.optional(v.array(v.string())),
    skillOverrides: v.optional(v.array(skillOverrideEntry)),
    integrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    await assertOwnedRemoteMcpTargets(ctx, userId, args.integrationOverrides);
    const persona = await ctx.db.get(args.personaId);
    if (!persona || persona.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Persona not found or unauthorized" });
    }

    const now = Date.now();
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

    const {
      personaId,
      avatarImageStorageId,
      personaDescription,
      temperature,
      maxTokens,
      includeReasoning,
      reasoningEffort,
      avatarEmoji,
      ...updates
    } = args;
    const previousAvatarStorageId = persona.avatarImageStorageId as Id<"_storage"> | undefined;
    const nextAvatarStorageId =
      avatarImageStorageId === null ? undefined : (avatarImageStorageId ?? previousAvatarStorageId);

    await ctx.db.patch(personaId, {
      ...updates,
      ...(personaDescription !== undefined ? { personaDescription: personaDescription ?? undefined } : {}),
      ...(temperature !== undefined ? { temperature: temperature ?? undefined } : {}),
      ...(maxTokens !== undefined ? { maxTokens: maxTokens ?? undefined } : {}),
      ...(includeReasoning !== undefined ? { includeReasoning: includeReasoning ?? undefined } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort: reasoningEffort ?? undefined } : {}),
      ...(avatarEmoji !== undefined ? { avatarEmoji: avatarEmoji ?? undefined } : {}),
      avatarImageStorageId: nextAvatarStorageId,
      updatedAt: now,
    });

    if (previousAvatarStorageId && previousAvatarStorageId !== nextAvatarStorageId) {
      await deletePersonaAvatarUnlessHistoricallyReferenced(ctx, {
        _id: persona._id,
        avatarImageStorageId: previousAvatarStorageId,
      });
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
    await removePersonaAdvisorAssignments(ctx, args.personaId, userId);
    await deletePersonaAvatarUnlessHistoricallyReferenced(ctx, persona);
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
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Persona not found or unauthorized" });
    }
    await removePersonaAdvisorAssignments(ctx, args.personaId, args.userId);
    await deletePersonaAvatarUnlessHistoricallyReferenced(ctx, persona);
    await ctx.db.delete(args.personaId);
  },
});

async function removePersonaAdvisorAssignments(
  ctx: MutationCtx,
  personaId: Id<"personas">,
  userId: string,
): Promise<void> {
  const assignments = await ctx.db
    .query("chatAdvisors")
    .withIndex("by_persona", (query) => query.eq("personaId", personaId))
    .collect();
  for (const assignment of assignments) {
    if (assignment.userId === userId) await ctx.db.delete(assignment._id);
  }
}

async function deletePersonaAvatarUnlessHistoricallyReferenced(
  ctx: MutationCtx,
  persona: { _id: Id<"personas">; avatarImageStorageId?: Id<"_storage"> },
): Promise<void> {
  if (!persona.avatarImageStorageId) return;
  const historicalRun = await ctx.db
    .query("advisorRuns")
    .withIndex("by_persona_avatar_storage", (query) =>
      query
        .eq("personaId", persona._id)
        .eq("personaAvatarStorageId", persona.avatarImageStorageId)
    )
    .first();
  if (!historicalRun) await ctx.storage.delete(persona.avatarImageStorageId);
}
