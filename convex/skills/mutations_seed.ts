// convex/skills/mutations_seed.ts
// =============================================================================
// Idempotent upsert mutation for seeding system skills from catalog constants.
//
// Called by `seedSystemCatalog` action in actions.ts.
// Looks up by slug, inserts if missing, updates if existing.
// =============================================================================

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { skillToolProfile } from "../schema_validators";
import type { Doc, Id } from "../_generated/dataModel";

/** Union of valid skill tool profile values. */
type SkillToolProfile =
  | "docs"
  | "analytics"
  | "workspace"
  | "persistentRuntime"
  | "subagents"
  | "google"
  | "microsoft"
  | "notion"
  | "appleCalendar"
  | "cloze"
  | "slack"
  | "scheduledJobs"
  | "skillsManagement"
  | "personas";

/**
 * TypeScript type matching the args below — exported so catalog constants
 * can be typed without importing Convex validators.
 */
export interface SystemSkillSeedData {
  slug: string;
  name: string;
  summary: string;
  instructionsRaw: string;
  instructionsCompiled: string | undefined;
  compilationStatus: "pending" | "compiled" | "failed";
  scope: "system";
  origin: "anthropicCurated" | "nanthaiBuiltin";
  visibility: "visible" | "hidden" | "integration_managed";
  lockState: "locked" | "editable";
  status: "active" | "archived";
  runtimeMode: "textOnly" | "toolAugmented" | "sandboxAugmented";
  requiredToolIds: string[];
  requiredToolProfiles?: SkillToolProfile[];
  requiredIntegrationIds: string[];
  requiredCapabilities?: string[];
}

/**
 * Idempotent upsert: insert if no skill with this slug exists,
 * otherwise patch the existing record.
 *
 * System skills are always scope="system" with no ownerUserId.
 */
export const upsertSystemSkill = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    summary: v.string(),
    instructionsRaw: v.string(),
    instructionsCompiled: v.optional(v.string()),
    compilationStatus: v.union(
      v.literal("pending"),
      v.literal("compiled"),
      v.literal("failed"),
    ),
    scope: v.literal("system"),
    origin: v.union(
      v.literal("anthropicCurated"),
      v.literal("nanthaiBuiltin"),
    ),
    visibility: v.union(v.literal("visible"), v.literal("hidden"), v.literal("integration_managed")),
    lockState: v.union(v.literal("locked"), v.literal("editable")),
    status: v.union(v.literal("active"), v.literal("archived")),
    runtimeMode: v.union(
      v.literal("textOnly"),
      v.literal("toolAugmented"),
      v.literal("sandboxAugmented"),
    ),
    requiredToolIds: v.array(v.string()),
    requiredToolProfiles: v.optional(v.array(skillToolProfile)),
    requiredIntegrationIds: v.array(v.string()),
    requiredCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Look up existing system skill by slug (filter for scope="system" to
    // avoid accidentally matching a user-owned skill with the same slug).
    const candidates = await ctx.db
      .query("skills")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .collect();
    const existing = candidates.find((s) => s.scope === "system") ?? null;

    if (existing) {
      // Patch existing — preserve _id, createdAt, version (bump it)
      await ctx.db.patch(existing._id, {
        name: args.name,
        summary: args.summary,
        instructionsRaw: args.instructionsRaw,
        instructionsCompiled: args.instructionsCompiled,
        compilationStatus: args.compilationStatus,
        scope: args.scope,
        origin: args.origin,
        visibility: args.visibility,
        lockState: args.lockState,
        status: args.status,
        runtimeMode: args.runtimeMode,
        requiredToolIds: args.requiredToolIds,
        requiredToolProfiles: args.requiredToolProfiles ?? [],
        requiredIntegrationIds: args.requiredIntegrationIds,
        requiredCapabilities: args.requiredCapabilities ?? [],
        unsupportedCapabilityCodes: [],
        validationWarnings: [],
        version: (existing.version ?? 0) + 1,
        updatedAt: now,
      });
      console.info(`[skills/seed] Updated system skill "${args.slug}" (v${(existing.version ?? 0) + 1}).`);
      return existing._id;
    }

    // Insert new
    const skillId = await ctx.db.insert("skills", {
      slug: args.slug,
      name: args.name,
      summary: args.summary,
      instructionsRaw: args.instructionsRaw,
      instructionsCompiled: args.instructionsCompiled,
      compilationStatus: args.compilationStatus,
      scope: args.scope,
      ownerUserId: undefined,
      origin: args.origin,
      visibility: args.visibility,
      lockState: args.lockState,
      status: args.status,
      runtimeMode: args.runtimeMode,
      requiredToolIds: args.requiredToolIds,
      requiredToolProfiles: args.requiredToolProfiles ?? [],
      requiredIntegrationIds: args.requiredIntegrationIds,
      requiredCapabilities: args.requiredCapabilities ?? [],
      unsupportedCapabilityCodes: [],
      validationWarnings: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    console.info(`[skills/seed] Inserted system skill "${args.slug}" (new).`);
    return skillId;
  },
});

/**
 * Hard-delete removed system skills after the catalog seed has converged.
 *
 * This is intentionally scoped to explicit slugs from the current catalog
 * module, not a generic "delete anything missing" prune. It keeps the seed
 * action safe for historical system skills that may be temporarily omitted
 * during development while still allowing deliberate catalog consolidation.
 */
export const deleteRemovedSystemSkills = internalMutation({
  args: {
    slugs: v.array(v.string()),
  },
  handler: async (ctx, { slugs }) => {
    const skillIdsToDelete: Id<"skills">[] = [];

    for (const slug of slugs) {
      const candidates = await ctx.db
        .query("skills")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .collect();
      for (const skill of candidates) {
        if (skill.scope === "system") {
          skillIdsToDelete.push(skill._id);
        }
      }
    }

    if (skillIdsToDelete.length === 0) {
      return { deletedCount: 0 };
    }

    const skillIdSet = new Set(skillIdsToDelete.map(String));
    const now = Date.now();

    const preferences = await ctx.db.query("userPreferences").collect();
    for (const prefs of preferences) {
      const skillDefaults = prefs.skillDefaults ?? [];
      const nextDefaults = skillDefaults.filter((entry) => !skillIdSet.has(String(entry.skillId)));
      if (nextDefaults.length === skillDefaults.length) continue;
      await ctx.db.patch(prefs._id, {
        skillDefaults: nextDefaults.length > 0 ? nextDefaults : undefined,
        updatedAt: now,
      });
    }

    const personas = await ctx.db.query("personas").collect();
    for (const persona of personas) {
      const skillOverrides = persona.skillOverrides ?? [];
      const nextOverrides = skillOverrides.filter((entry) => !skillIdSet.has(String(entry.skillId)));
      if (nextOverrides.length === skillOverrides.length) continue;
      await ctx.db.patch(persona._id, {
        skillOverrides: nextOverrides.length > 0 ? nextOverrides : undefined,
        updatedAt: now,
      });
    }

    const chats = await ctx.db.query("chats").collect();
    for (const chat of chats) {
      const skillOverrides = chat.skillOverrides ?? [];
      const nextOverrides = skillOverrides.filter((entry) => !skillIdSet.has(String(entry.skillId)));
      if (nextOverrides.length === skillOverrides.length) continue;
      await ctx.db.patch(chat._id, {
        skillOverrides: nextOverrides.length > 0 ? nextOverrides : undefined,
        updatedAt: now,
      });
    }

    const scheduledJobs = await ctx.db.query("scheduledJobs").collect();
    for (const job of scheduledJobs) {
      const topLevel = filterSkillOverrideEntries(job.turnSkillOverrides, skillIdSet);
      let stepsChanged = false;
      const nextSteps = job.steps?.map((step) => {
        const filtered = filterSkillOverrideEntries(step.turnSkillOverrides, skillIdSet);
        if (!filtered.changed) return step;
        stepsChanged = true;
        return { ...step, turnSkillOverrides: filtered.next };
      });
      if (!topLevel.changed && !stepsChanged) continue;

      const updates: Partial<Doc<"scheduledJobs">> = { updatedAt: now };
      if (topLevel.changed) updates.turnSkillOverrides = topLevel.next;
      if (stepsChanged) updates.steps = nextSteps;
      await ctx.db.patch(job._id, updates);
    }

    for (const skillId of skillIdsToDelete) {
      await ctx.db.delete(skillId);
    }

    console.info(`[skills/seed] Deleted ${skillIdsToDelete.length} removed system skills.`);
    return { deletedCount: skillIdsToDelete.length };
  },
});

function filterSkillOverrideEntries<T extends { skillId: Id<"skills"> }>(
  entries: T[] | undefined,
  skillIdSet: Set<string>,
): { changed: boolean; next: T[] | undefined } {
  if (!entries || entries.length === 0) {
    return { changed: false, next: entries };
  }
  const next = entries.filter((entry) => !skillIdSet.has(String(entry.skillId)));
  return {
    changed: next.length !== entries.length,
    next: next.length > 0 ? next : undefined,
  };
}
