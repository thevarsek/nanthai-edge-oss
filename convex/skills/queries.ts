// convex/skills/queries.ts
// =============================================================================
// Read-only queries for the skills system.
// =============================================================================

import { query, internalQuery } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { optionalAuth } from "../lib/auth";
import { listActiveCapabilities, type CapabilityName } from "../capabilities/shared";

// ── Shared query logic ───────────────────────────────────────────────────

/**
 * Fetch active visible system skills + all active user skills for a user.
 * Used by both listVisibleSkills and listDiscoverableSkills.
 */
async function fetchVisibleSkills(ctx: QueryCtx, userId: string) {
  const capabilitySet = new Set(await listActiveCapabilities(ctx, userId));
  const systemSkills = await ctx.db
    .query("skills")
    .withIndex("by_scope", (q) => q.eq("scope", "system").eq("status", "active"))
    .collect();

  const userSkills = await ctx.db
    .query("skills")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", userId).eq("status", "active"))
    .collect();

  const isEligible = (skill: (typeof systemSkills)[number]) => {
    if (skill.visibility !== "visible") return false;
    const requiredCapabilities = skill.requiredCapabilities ?? [];
    return requiredCapabilities.every((capability) => capabilitySet.has(capability as CapabilityName));
  };

  const visible = systemSkills.filter(isEligible);
  const eligibleUserSkills = userSkills.filter(isEligible);
  return [...visible, ...eligibleUserSkills];
}

// ── Public queries (called from iOS client) ─────────────────────────────

/**
 * List all skills visible to the current user:
 * - All system-scope active visible skills
 * - All user-scope active skills owned by this user
 */
export const listVisibleSkills = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return [];
    return await fetchVisibleSkills(ctx, auth.userId);
  },
});

/**
 * Get full detail for a single skill.
 * Only returns system skills or skills owned by the authenticated user.
 */
export const getSkillDetail = query({
  args: { skillId: v.id("skills") },
  handler: async (ctx, { skillId }) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return null;

    const skill = await ctx.db.get(skillId);
    if (!skill) return null;

    // System skills are readable by all authenticated users
    if (skill.scope === "system") return skill;

    // User skills are only readable by their owner
    if (skill.ownerUserId !== auth.userId) return null;

    return skill;
  },
});

/**
 * List skills available for persona/chat assignment.
 * Returns active, visible skills (system + user's own).
 * Functionally identical to listVisibleSkills — kept as a separate
 * endpoint for semantic clarity in the client API.
 */
export const listDiscoverableSkills = query({
  args: {},
  handler: async (ctx) => {
    const auth = await optionalAuth(ctx);
    if (!auth) return [];
    return await fetchVisibleSkills(ctx, auth.userId);
  },
});

// ── Internal queries (called from backend actions/tools) ────────────────

/**
 * List all visible skills for a given user (internal version).
 * Used by skill management tools.
 */
export const listVisibleSkillsInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const systemSkills = await ctx.db
      .query("skills")
      .withIndex("by_scope", (q) => q.eq("scope", "system").eq("status", "active"))
      .collect();

    const userSkills = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId).eq("status", "active"))
      .collect();

    const visible = systemSkills.filter((s) => s.visibility === "visible");
    return [...visible, ...userSkills];
  },
});

/**
 * Look up a skill by slug. Used by the `load_skill` tool.
 * Returns null if not found or not active.
 */
export const getSkillBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const skill = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .first();

    if (!skill || skill.status !== "active") {
      return null;
    }
    return skill;
  },
});

/**
 * Look up a skill by slug, scoped to a specific user (for user-authored skills).
 * Falls back to system skills if no user match.
 */
export const getSkillBySlugForUser = internalQuery({
  args: { slug: v.string(), userId: v.string() },
  handler: async (ctx, { slug, userId }) => {
    // Try user-owned skill first (user might have a custom slug)
    const allBySlug = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .collect();

    const active = allBySlug.filter((s) => s.status === "active");

    // Prefer user-owned if exists
    const userOwned = active.find((s) => s.ownerUserId === userId);
    if (userOwned) return userOwned;

    // Fall back to system
    const system = active.find((s) => s.scope === "system");
    return system ?? null;
  },
});

/**
 * Get multiple skills by their IDs. Used for building the catalog.
 * Filters out missing/inactive skills silently.
 */
export const getSkillsByIds = internalQuery({
  args: { skillIds: v.array(v.id("skills")) },
  handler: async (ctx, { skillIds }) => {
    const skills = await Promise.all(
      skillIds.map((id) => ctx.db.get(id)),
    );
    return skills.filter(
      (s): s is NonNullable<typeof s> => s !== null && s.status === "active",
    );
  },
});

/**
 * List all active system skills (visible + hidden).
 * Used by buildSkillCatalog.
 */
export const listActiveSystemSkills = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("skills")
      .withIndex("by_scope", (q) => q.eq("scope", "system").eq("status", "active"))
      .collect();
  },
});

/**
 * List user skills for internal use (tool execution context).
 */
export const listUserSkillsInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId).eq("status", "active"))
      .collect();
  },
});
