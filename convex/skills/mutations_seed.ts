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

/** Union of valid skill tool profile values. */
type SkillToolProfile =
  | "docs"
  | "analytics"
  | "workspace"
  | "subagents"
  | "google"
  | "microsoft"
  | "notion"
  | "appleCalendar"
  | "scheduledJobs"
  | "skillsManagement";

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
  visibility: "visible" | "hidden";
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
    visibility: v.union(v.literal("visible"), v.literal("hidden")),
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
