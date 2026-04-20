// convex/skills/mutations.ts
// =============================================================================
// Mutations for skill CRUD and persona/chat skill assignment.
//
// Public mutations are called from the iOS client.
// Internal mutations are called from AI tools (via actions).
// =============================================================================

import { mutation, internalMutation, MutationCtx } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { Id } from "../_generated/dataModel";
import { requireAuth, requirePro } from "../lib/auth";
import { skillToolProfile, skillOverrideEntry, integrationOverrideEntry } from "../schema_validators";
import {
  validateSkillInstructions,
  validateToolIds,
  validateIntegrationIds,
  validateCapabilityIds,
  slugify,
} from "./validators";
import { normalizeSkillMetadata, validateToolProfileIds } from "./tool_profiles";

const skillRuntimeModeValidator = v.union(
  v.literal("textOnly"),
  v.literal("toolAugmented"),
  v.literal("sandboxAugmented"),
);

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Remove all references to a skill from the owner's personas and chats.
 * Called before hard-deleting a skill to prevent dangling IDs.
 */
async function removeSkillReferences(
  ctx: MutationCtx,
  skillId: Id<"skills">,
  userId: string,
): Promise<void> {
  const skillIdStr = String(skillId);

  // Clean up userPreferences skillDefaults
  const prefs = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (prefs?.skillDefaults?.some((d) => String(d.skillId) === skillIdStr)) {
    await ctx.db.patch(prefs._id, {
      skillDefaults: prefs.skillDefaults.filter((d) => String(d.skillId) !== skillIdStr),
    });
  }

  // Clean up personas owned by this user
  const personas = await ctx.db
    .query("personas")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  for (const persona of personas) {
    const overrides = persona.skillOverrides;
    const hasOverride = overrides && overrides.some((o) => String(o.skillId) === skillIdStr);
    if (!hasOverride) continue;

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (hasOverride) {
      updates.skillOverrides = overrides!.filter((o) => String(o.skillId) !== skillIdStr);
    }
    await ctx.db.patch(persona._id, updates);
  }

  // Clean up chats owned by this user that reference this skill
  // Note: We can't index chats by skill ID, so we query by user.
  // This is acceptable since deletion is infrequent.
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();

  for (const chat of chats) {
    const overrides = chat.skillOverrides;
    const hasOverride = overrides && overrides.some((o) => String(o.skillId) === skillIdStr);
    if (!hasOverride) continue;

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (hasOverride) {
      updates.skillOverrides = overrides!.filter((o) => String(o.skillId) !== skillIdStr);
    }
    await ctx.db.patch(chat._id, updates);
  }
}

/**
 * Check whether a slug collides with any active system skill.
 * Prevents user skills from shadowing system skills.
 */
async function checkSystemSlugCollision(
  ctx: MutationCtx,
  slug: string,
): Promise<void> {
  const existing = await ctx.db
    .query("skills")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .collect();
  const systemMatch = existing.find((s) => s.scope === "system" && s.status === "active");
  if (systemMatch) {
    throw new ConvexError({
      code: "SLUG_COLLISION" as const,
      message: `The name "${slug}" is already used by a built-in skill ("${systemMatch.name}"). Please choose a different name.`,
    });
  }
}

interface SkillMetadataArgs {
  instructionsRaw?: string;
  runtimeMode?: "textOnly" | "toolAugmented" | "sandboxAugmented";
  requiredToolIds?: string[];
  requiredToolProfiles?: string[];
  requiredIntegrationIds?: string[];
  requiredCapabilities?: string[];
}

async function validateAndNormalizeSkillMetadata(
  _ctx: MutationCtx,
  _userId: string,
  args: SkillMetadataArgs,
  existing?: {
    instructionsRaw: string;
    runtimeMode: "textOnly" | "toolAugmented" | "sandboxAugmented";
    requiredToolIds: string[];
    requiredToolProfiles?: string[];
    requiredIntegrationIds: string[];
    requiredCapabilities?: string[];
  },
) {
  const instructionsRaw = args.instructionsRaw ?? existing?.instructionsRaw ?? "";
  const runtimeMode = args.runtimeMode ?? existing?.runtimeMode ?? "textOnly";
  const requiredToolIds = args.requiredToolIds ?? existing?.requiredToolIds ?? [];
  const requiredToolProfiles = args.requiredToolProfiles ?? existing?.requiredToolProfiles ?? [];
  const requiredIntegrationIds = args.requiredIntegrationIds ?? existing?.requiredIntegrationIds ?? [];
  const requiredCapabilities = args.requiredCapabilities ?? existing?.requiredCapabilities ?? [];

  const validation = validateSkillInstructions(instructionsRaw);
  if (!validation.isCompatible) {
    const errorFindings = validation.findings.filter((f) => f.severity === "error");
    const reasons = errorFindings.map((f) => f.message);
    const codes = errorFindings.map((f) => f.code);

    // Build a user-friendly explanation for why the skill was rejected.
    const detailLines: string[] = [];
    for (const finding of errorFindings) {
      switch (finding.code) {
        case "USES_BASH":
          detailLines.push(
            "• References shell commands (bash, terminal, CLI, npm, pip, etc.).",
          );
          break;
        case "USES_FILESYSTEM":
          detailLines.push(
            "• References local files or scripts (scripts/*.py, references/*.md, assets/*, etc.).",
          );
          break;
        case "USES_BROWSER":
          detailLines.push(
            "• References browser automation (Playwright, Puppeteer, screenshots, etc.).",
          );
          break;
        case "USES_MCP":
          detailLines.push(
            "• References MCP servers or external process management.",
          );
          break;
        case "USES_RAW_FETCH":
          detailLines.push(
            "• References raw HTTP requests (fetch, curl, wget, axios, etc.).",
          );
          break;
        case "USES_BUNDLED_SCRIPTS":
          detailLines.push(
            "• References bundled scripts that must be executed locally.",
          );
          break;
        case "USES_GIT":
          detailLines.push(
            "• References git operations (clone, push, commit, etc.).",
          );
          break;
        default:
          detailLines.push(`• ${finding.message}`);
      }
    }

    const userMessage =
      "This skill can't be saved because it references capabilities that " +
      "aren't available in NanthAI. The AI doesn't have a secure environment " +
      "to run code, access the filesystem, or execute shell commands.\n\n" +
      "Issues found:\n" +
      detailLines.join("\n") +
      "\n\nTo fix this, remove the references to local scripts, shell commands, " +
      "and file paths from your skill instructions. Focus the instructions on " +
      "what the AI should know and how it should respond — not on tools it " +
      "should run.";

    throw new ConvexError({
      code: "SKILL_INCOMPATIBLE" as const,
      message: userMessage,
      reasons,
      codes,
    });
  }

  const unknownTools = validateToolIds(requiredToolIds);
  if (unknownTools.length > 0) {
    throw new ConvexError({
      code: "UNKNOWN_TOOL_IDS" as const,
      message: `Unknown tool IDs: ${unknownTools.join(", ")}. Check the tool IDs and try again.`,
    });
  }
  const unknownProfiles = validateToolProfileIds(requiredToolProfiles);
  if (unknownProfiles.length > 0) {
    throw new ConvexError({
      code: "UNKNOWN_TOOL_PROFILES" as const,
      message: `Unknown tool profile IDs: ${unknownProfiles.join(", ")}. Check the profile IDs and try again.`,
    });
  }
  const unknownIntegrations = validateIntegrationIds(requiredIntegrationIds);
  if (unknownIntegrations.length > 0) {
    throw new ConvexError({
      code: "UNKNOWN_INTEGRATIONS" as const,
      message: `Unknown integration IDs: ${unknownIntegrations.join(", ")}. Check the integration IDs and try again.`,
    });
  }
  const unknownCapabilities = validateCapabilityIds(requiredCapabilities);
  if (unknownCapabilities.length > 0) {
    throw new ConvexError({
      code: "UNKNOWN_CAPABILITIES" as const,
      message: `Unknown capability IDs: ${unknownCapabilities.join(", ")}. Check the capability IDs and try again.`,
    });
  }

  const normalized = normalizeSkillMetadata(
    {
      instructionsRaw,
      runtimeMode,
      requiredToolIds,
      requiredToolProfiles,
      requiredIntegrationIds,
      requiredCapabilities,
    },
    validation.findings,
  );

  return { validation, normalized };
}

// ── Internal mutations (called from AI tools and backend actions) ────────

/**
 * Create a new user skill. Validates instructions and saves with
 * compilationStatus: "compiled" (no LLM compilation in v1).
 */
export const createSkillInternal = internalMutation({
  args: {
    userId: v.string(),
    name: v.string(),
    summary: v.string(),
    instructionsRaw: v.string(),
    runtimeMode: v.optional(skillRuntimeModeValidator),
    requiredToolIds: v.optional(v.array(v.string())),
    requiredToolProfiles: v.optional(v.array(skillToolProfile)),
    requiredIntegrationIds: v.optional(v.array(v.string())),
    requiredCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const slug = slugify(args.name);

    // Prevent shadowing system skills
    await checkSystemSlugCollision(ctx, slug);

    // Check for duplicate slug among user's skills
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", args.userId).eq("status", "active"))
      .collect();
    const duplicate = existing.find((s) => s.slug === slug);
    if (duplicate) {
      throw new ConvexError({
        code: "DUPLICATE_SLUG" as const,
        message: `A skill with the slug "${slug}" already exists. Choose a different name.`,
      });
    }

    const { validation, normalized } = await validateAndNormalizeSkillMetadata(
      ctx,
      args.userId,
      args,
    );

    const skillId = await ctx.db.insert("skills", {
      slug,
      name: args.name.trim(),
      summary: args.summary.trim(),
      instructionsRaw: args.instructionsRaw,
      compilationStatus: "compiled",
      scope: "user",
      ownerUserId: args.userId,
      origin: "assistantAuthored",
      visibility: "visible",
      lockState: "editable",
      status: "active",
      runtimeMode: normalized.runtimeMode,
      requiredToolIds: normalized.requiredToolIds,
      requiredToolProfiles: normalized.requiredToolProfiles,
      requiredIntegrationIds: normalized.requiredIntegrationIds,
      requiredCapabilities: normalized.requiredCapabilities,
      unsupportedCapabilityCodes: validation.unsupportedCapabilityCodes,
      validationWarnings: [
        ...validation.validationWarnings,
        ...normalized.metadataWarnings,
      ],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    return { skillId, validationWarnings: [
      ...validation.validationWarnings,
      ...normalized.metadataWarnings,
    ] };
  },
});

/**
 * Update an existing user skill. Re-validates instructions.
 */
export const updateSkillInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    userId: v.string(),
    name: v.optional(v.string()),
    summary: v.optional(v.string()),
    instructionsRaw: v.optional(v.string()),
    runtimeMode: v.optional(skillRuntimeModeValidator),
    requiredToolIds: v.optional(v.array(v.string())),
    requiredToolProfiles: v.optional(v.array(skillToolProfile)),
    requiredIntegrationIds: v.optional(v.array(v.string())),
    requiredCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Skill not found." });
    if (skill.ownerUserId !== args.userId) throw new ConvexError({ code: "UNAUTHORIZED" as const, message: "Not authorized to edit this skill." });
    if (skill.lockState === "locked") throw new ConvexError({ code: "LOCKED" as const, message: "This skill is locked and cannot be edited." });

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.name !== undefined) {
      const newSlug = slugify(args.name);
      if (newSlug !== skill.slug) {
        await checkSystemSlugCollision(ctx, newSlug);
        const userSkills = await ctx.db
          .query("skills")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", args.userId).eq("status", "active"))
          .collect();
        const duplicate = userSkills.find((s) => s.slug === newSlug && String(s._id) !== String(args.skillId));
        if (duplicate) {
          throw new ConvexError({
            code: "DUPLICATE_SLUG" as const,
            message: `A skill with the slug "${newSlug}" already exists. Choose a different name.`,
          });
        }
      }
      updates.name = args.name.trim();
      updates.slug = newSlug;
    }
    if (args.summary !== undefined) {
      updates.summary = args.summary.trim();
    }

    const { validation, normalized } = await validateAndNormalizeSkillMetadata(
      ctx,
      args.userId,
      args,
      {
        instructionsRaw: skill.instructionsRaw,
        runtimeMode: skill.runtimeMode,
        requiredToolIds: skill.requiredToolIds,
        requiredToolProfiles: skill.requiredToolProfiles ?? [],
        requiredIntegrationIds: skill.requiredIntegrationIds,
        requiredCapabilities: skill.requiredCapabilities ?? [],
      },
    );

    updates.instructionsRaw = args.instructionsRaw ?? skill.instructionsRaw;
    updates.compilationStatus = "compiled";
    updates.runtimeMode = normalized.runtimeMode;
    updates.requiredToolIds = normalized.requiredToolIds;
    updates.requiredToolProfiles = normalized.requiredToolProfiles;
    updates.requiredIntegrationIds = normalized.requiredIntegrationIds;
    updates.requiredCapabilities = normalized.requiredCapabilities;
    updates.unsupportedCapabilityCodes = validation.unsupportedCapabilityCodes;
    const validationWarnings = [
      ...validation.validationWarnings,
      ...normalized.metadataWarnings,
    ];
    updates.validationWarnings = validationWarnings;

    updates.version = (skill.version ?? 0) + 1;

    await ctx.db.patch(args.skillId, updates);

    return { skillId: args.skillId, validationWarnings };
  },
});

/**
 * Archive a user skill from the Settings UI.
 */
export const archiveSkillInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    userId: v.string(),
  },
  handler: async (ctx, { skillId, userId }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Skill not found." });
    if (skill.scope === "system") throw new ConvexError({ code: "FORBIDDEN" as const, message: "System skills cannot be archived." });
    if (skill.ownerUserId !== userId) throw new ConvexError({ code: "UNAUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(skillId, {
      status: "archived",
      updatedAt: Date.now(),
    });
  },
});

/**
 * Hard delete a user skill. Cleans up dangling references in personas and chats.
 */
export const deleteSkillInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    userId: v.string(),
  },
  handler: async (ctx, { skillId, userId }) => {
    const skill = await ctx.db.get(skillId);
    if (!skill) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Skill not found." });
    if (skill.scope === "system") throw new ConvexError({ code: "FORBIDDEN" as const, message: "System skills cannot be deleted." });
    if (skill.ownerUserId !== userId) throw new ConvexError({ code: "UNAUTHORIZED" as const, message: "Not authorized." });

    await removeSkillReferences(ctx, skillId, userId);
    await ctx.db.delete(skillId);
  },
});

/**
 * Duplicate a system skill to user scope for customization.
 */
export const duplicateSystemSkillInternal = internalMutation({
  args: {
    skillId: v.id("skills"),
    userId: v.string(),
  },
  handler: async (ctx, { skillId, userId }) => {
    const source = await ctx.db.get(skillId);
    if (!source) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Source skill not found." });
    if (source.scope !== "system") throw new ConvexError({ code: "FORBIDDEN" as const, message: "Can only duplicate system skills." });

    const now = Date.now();
    let newSlug = `${source.slug}-custom`;

    // Ensure no slug collision with existing user skills
    const userSkills = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId).eq("status", "active"))
      .collect();
    let suffix = 1;
    while (userSkills.some((s) => s.slug === newSlug)) {
      suffix++;
      newSlug = `${source.slug}-custom-${suffix}`;
    }

    const newId = await ctx.db.insert("skills", {
      slug: newSlug,
      name: `${source.name} (Custom${suffix > 1 ? ` ${suffix}` : ""})`,
      summary: source.summary,
      instructionsRaw: source.instructionsRaw,
      instructionsCompiled: source.instructionsCompiled,
      compilationStatus: source.compilationStatus,
      scope: "user",
      ownerUserId: userId,
      origin: "userAuthored",
      visibility: "visible",
      lockState: "editable",
      status: "active",
      runtimeMode: source.runtimeMode,
      requiredToolIds: source.requiredToolIds,
      requiredToolProfiles: source.requiredToolProfiles ?? [],
      requiredIntegrationIds: source.requiredIntegrationIds,
      requiredCapabilities: source.requiredCapabilities ?? [],
      unsupportedCapabilityCodes: source.unsupportedCapabilityCodes,
      validationWarnings: source.validationWarnings,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    return newId;
  },
});

// ── Persona/Chat skill assignment ────────────────────────────────────────

/**
 * Set discoverable skills for a persona.
 */
export const setPersonaSkills = internalMutation({
  args: {
    personaId: v.id("personas"),
    userId: v.string(),
    discoverableSkillIds: v.array(v.id("skills")),
  },
  handler: async (ctx, { personaId, userId, discoverableSkillIds }) => {
    const persona = await ctx.db.get(personaId);
    if (!persona) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Persona not found." });
    if (persona.userId !== userId) throw new ConvexError({ code: "UNAUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(personaId, {
      skillOverrides: discoverableSkillIds.map((skillId) => ({
        skillId,
        state: "available" as const,
      })),
      updatedAt: Date.now(),
    });
  },
});

/**
 * Set skill overrides for a chat.
 */
export const setChatSkills = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    discoverableSkillIds: v.optional(v.array(v.id("skills"))),
    disabledSkillIds: v.optional(v.array(v.id("skills"))),
  },
  handler: async (ctx, { chatId, userId, discoverableSkillIds, disabledSkillIds }) => {
    const chat = await ctx.db.get(chatId);
    if (!chat) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found." });
    if (chat.userId !== userId) throw new ConvexError({ code: "UNAUTHORIZED" as const, message: "Not authorized." });

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    const nextOverrides = new Map<string, "always" | "available" | "never">();
    for (const existing of chat.skillOverrides ?? []) {
      nextOverrides.set(String(existing.skillId), existing.state);
    }
    if (discoverableSkillIds !== undefined) {
      for (const skillId of discoverableSkillIds) {
        nextOverrides.set(String(skillId), "available");
      }
    }
    if (disabledSkillIds !== undefined) {
      for (const skillId of disabledSkillIds) {
        nextOverrides.set(String(skillId), "never");
      }
    }
    updates.skillOverrides = Array.from(nextOverrides, ([skillId, state]) => ({
      skillId: skillId as Id<"skills">,
      state,
    }));

    await ctx.db.patch(chatId, updates);
  },
});

// ── Public mutations (called from iOS client) ────────────────────────────

/**
 * Create a user skill from the Settings UI.
 */
export const createSkill = mutation({
  args: {
    name: v.string(),
    summary: v.string(),
    instructionsRaw: v.string(),
    runtimeMode: v.optional(skillRuntimeModeValidator),
    requiredToolIds: v.optional(v.array(v.string())),
    requiredToolProfiles: v.optional(v.array(skillToolProfile)),
    requiredIntegrationIds: v.optional(v.array(v.string())),
    requiredCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const now = Date.now();
    const slug = slugify(args.name);

    // Prevent shadowing system skills
    await checkSystemSlugCollision(ctx, slug);

    // Check for duplicate slug among user's skills
    const existing = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId).eq("status", "active"))
      .collect();
    const duplicate = existing.find((s) => s.slug === slug);
    if (duplicate) {
      throw new ConvexError({
        code: "DUPLICATE_SLUG" as const,
        message: `You already have a skill named "${slug}". Please choose a different name.`,
      });
    }

    const { validation, normalized } = await validateAndNormalizeSkillMetadata(
      ctx,
      userId,
      args,
    );

    const skillId = await ctx.db.insert("skills", {
      slug,
      name: args.name.trim(),
      summary: args.summary.trim(),
      instructionsRaw: args.instructionsRaw,
      compilationStatus: "compiled",
      scope: "user",
      ownerUserId: userId,
      origin: "userAuthored",
      visibility: "visible",
      lockState: "editable",
      status: "active",
      runtimeMode: normalized.runtimeMode,
      requiredToolIds: normalized.requiredToolIds,
      requiredToolProfiles: normalized.requiredToolProfiles,
      requiredIntegrationIds: normalized.requiredIntegrationIds,
      requiredCapabilities: normalized.requiredCapabilities,
      unsupportedCapabilityCodes: validation.unsupportedCapabilityCodes,
      validationWarnings: [
        ...validation.validationWarnings,
        ...normalized.metadataWarnings,
      ],
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    return { skillId, validationWarnings: [
      ...validation.validationWarnings,
      ...normalized.metadataWarnings,
    ] };
  },
});

/**
 * Update a user skill from the Settings UI.
 */
export const updateSkill = mutation({
  args: {
    skillId: v.id("skills"),
    name: v.optional(v.string()),
    summary: v.optional(v.string()),
    instructionsRaw: v.optional(v.string()),
    runtimeMode: v.optional(skillRuntimeModeValidator),
    requiredToolIds: v.optional(v.array(v.string())),
    requiredToolProfiles: v.optional(v.array(skillToolProfile)),
    requiredIntegrationIds: v.optional(v.array(v.string())),
    requiredCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const skill = await ctx.db.get(args.skillId);
    if (!skill) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Skill not found." });
    if (skill.ownerUserId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized to edit this skill." });
    if (skill.lockState === "locked") throw new ConvexError({ code: "LOCKED" as const, message: "This skill is locked and cannot be edited." });

    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };

    if (args.name !== undefined) {
      const newSlug = slugify(args.name);
      if (newSlug !== skill.slug) {
        await checkSystemSlugCollision(ctx, newSlug);
        const userSkills = await ctx.db
          .query("skills")
          .withIndex("by_owner", (q) => q.eq("ownerUserId", userId).eq("status", "active"))
          .collect();
        const duplicate = userSkills.find((s) => s.slug === newSlug && String(s._id) !== String(args.skillId));
        if (duplicate) {
          throw new ConvexError({
            code: "DUPLICATE_SLUG" as const,
            message: `You already have a skill named "${newSlug}". Please choose a different name.`,
          });
        }
      }
      updates.name = args.name.trim();
      updates.slug = newSlug;
    }
    if (args.summary !== undefined) {
      updates.summary = args.summary.trim();
    }
    const { validation, normalized } = await validateAndNormalizeSkillMetadata(
      ctx,
      userId,
      args,
      {
        instructionsRaw: skill.instructionsRaw,
        runtimeMode: skill.runtimeMode,
        requiredToolIds: skill.requiredToolIds,
        requiredToolProfiles: skill.requiredToolProfiles ?? [],
        requiredIntegrationIds: skill.requiredIntegrationIds,
        requiredCapabilities: skill.requiredCapabilities ?? [],
      },
    );

    updates.instructionsRaw = args.instructionsRaw ?? skill.instructionsRaw;
    updates.compilationStatus = "compiled";
    updates.runtimeMode = normalized.runtimeMode;
    updates.requiredToolIds = normalized.requiredToolIds;
    updates.requiredToolProfiles = normalized.requiredToolProfiles;
    updates.requiredIntegrationIds = normalized.requiredIntegrationIds;
    updates.requiredCapabilities = normalized.requiredCapabilities;
    updates.unsupportedCapabilityCodes = validation.unsupportedCapabilityCodes;
    const validationWarnings = [
      ...validation.validationWarnings,
      ...normalized.metadataWarnings,
    ];
    updates.validationWarnings = validationWarnings;

    updates.version = (skill.version ?? 0) + 1;
    await ctx.db.patch(args.skillId, updates);

    return { skillId: args.skillId, validationWarnings };
  },
});

/**
 * Archive a user skill from the Settings UI.
 */
export const archiveSkill = mutation({
  args: {
    skillId: v.id("skills"),
  },
  handler: async (ctx, { skillId }) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const skill = await ctx.db.get(skillId);
    if (!skill) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Skill not found." });
    if (skill.scope === "system") throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "System skills cannot be archived." });
    if (skill.ownerUserId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(skillId, { status: "archived", updatedAt: Date.now() });
  },
});

/**
 * Delete a user skill from the Settings UI.
 * Cleans up dangling references in personas and chats.
 */
export const deleteSkill = mutation({
  args: {
    skillId: v.id("skills"),
  },
  handler: async (ctx, { skillId }) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const skill = await ctx.db.get(skillId);
    if (!skill) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Skill not found." });
    if (skill.scope === "system") throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "System skills cannot be deleted." });
    if (skill.ownerUserId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    await removeSkillReferences(ctx, skillId, userId);
    await ctx.db.delete(skillId);
  },
});

/**
 * Duplicate a system skill to user scope.
 */
export const duplicateSystemSkill = mutation({
  args: {
    skillId: v.id("skills"),
  },
  handler: async (ctx, { skillId }) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const source = await ctx.db.get(skillId);
    if (!source) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Source skill not found." });
    if (source.scope !== "system") throw new ConvexError({ code: "INVALID_ARGS" as const, message: "Can only duplicate system skills." });

    const now = Date.now();

    // Ensure no slug collision with existing user skills
    let newSlug = `${source.slug}-custom`;
    const userSkills = await ctx.db
      .query("skills")
      .withIndex("by_owner", (q) => q.eq("ownerUserId", userId).eq("status", "active"))
      .collect();
    let suffix = 1;
    while (userSkills.some((s) => s.slug === newSlug)) {
      suffix++;
      newSlug = `${source.slug}-custom-${suffix}`;
    }

    const newId = await ctx.db.insert("skills", {
      slug: newSlug,
      name: `${source.name} (Custom${suffix > 1 ? ` ${suffix}` : ""})`,
      summary: source.summary,
      instructionsRaw: source.instructionsRaw,
      instructionsCompiled: source.instructionsCompiled,
      compilationStatus: source.compilationStatus,
      scope: "user",
      ownerUserId: userId,
      origin: "userAuthored",
      visibility: "visible",
      lockState: "editable",
      status: "active",
      runtimeMode: source.runtimeMode,
      requiredToolIds: source.requiredToolIds,
      requiredToolProfiles: source.requiredToolProfiles ?? [],
      requiredIntegrationIds: source.requiredIntegrationIds,
      requiredCapabilities: source.requiredCapabilities ?? [],
      unsupportedCapabilityCodes: source.unsupportedCapabilityCodes,
      validationWarnings: source.validationWarnings,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });

    return newId;
  },
});

// ── Persona/Chat skill assignment (public) ───────────────────────────────

export const setPersonaSkillsPublic = mutation({
  args: {
    personaId: v.id("personas"),
    discoverableSkillIds: v.array(v.id("skills")),
  },
  handler: async (ctx, { personaId, discoverableSkillIds }) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const persona = await ctx.db.get(personaId);
    if (!persona) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Persona not found." });
    if (persona.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(personaId, {
      skillOverrides: discoverableSkillIds.map((skillId) => ({
        skillId,
        state: "available" as const,
      })),
      updatedAt: Date.now(),
    });
  },
});

export const setChatSkillsPublic = mutation({
  args: {
    chatId: v.id("chats"),
    discoverableSkillIds: v.optional(v.array(v.id("skills"))),
    disabledSkillIds: v.optional(v.array(v.id("skills"))),
  },
  handler: async (ctx, { chatId, discoverableSkillIds, disabledSkillIds }) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const chat = await ctx.db.get(chatId);
    if (!chat) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found." });
    if (chat.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    const nextOverrides = new Map<string, "always" | "available" | "never">();
    for (const existing of chat.skillOverrides ?? []) {
      nextOverrides.set(String(existing.skillId), existing.state);
    }
    if (discoverableSkillIds !== undefined) {
      for (const skillId of discoverableSkillIds) {
        nextOverrides.set(String(skillId), "available");
      }
    }
    if (disabledSkillIds !== undefined) {
      for (const skillId of disabledSkillIds) {
        nextOverrides.set(String(skillId), "never");
      }
    }
    updates.skillOverrides = Array.from(nextOverrides, ([skillId, state]) => ({
      skillId: skillId as Id<"skills">,
      state,
    }));

    await ctx.db.patch(chatId, updates);
  },
});

// ── M30: Layered override mutations ──────────────────────────────────────

/**
 * Set skill overrides on a persona (M30 format).
 * Replaces the entire `skillOverrides` array.
 */
export const setPersonaSkillOverrides = mutation({
  args: {
    personaId: v.id("personas"),
    skillOverrides: v.array(skillOverrideEntry),
  },
  handler: async (ctx, { personaId, skillOverrides }) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const persona = await ctx.db.get(personaId);
    if (!persona) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Persona not found." });
    if (persona.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(personaId, {
      skillOverrides,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Set integration overrides on a persona (M30 format).
 */
export const setPersonaIntegrationOverrides = mutation({
  args: {
    personaId: v.id("personas"),
    integrationOverrides: v.array(integrationOverrideEntry),
  },
  handler: async (ctx, { personaId, integrationOverrides }) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const persona = await ctx.db.get(personaId);
    if (!persona) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Persona not found." });
    if (persona.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(personaId, {
      integrationOverrides,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Set skill overrides on a chat (M30 format).
 */
export const setChatSkillOverrides = mutation({
  args: {
    chatId: v.id("chats"),
    skillOverrides: v.array(skillOverrideEntry),
  },
  handler: async (ctx, { chatId, skillOverrides }) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(chatId);
    if (!chat) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found." });
    if (chat.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(chatId, {
      skillOverrides,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Set integration overrides on a chat (M30 format).
 */
export const setChatIntegrationOverrides = mutation({
  args: {
    chatId: v.id("chats"),
    integrationOverrides: v.array(integrationOverrideEntry),
  },
  handler: async (ctx, { chatId, integrationOverrides }) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(chatId);
    if (!chat) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found." });
    if (chat.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });

    await ctx.db.patch(chatId, {
      integrationOverrides,
      updatedAt: Date.now(),
    });
  },
});

// ── Internal variants for AI tool calls (skip auth, trust userId from tool context) ──

export const setChatSkillOverridesInternal = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    skillOverrides: v.array(skillOverrideEntry),
  },
  handler: async (ctx, { chatId, userId, skillOverrides }) => {
    const chat = await ctx.db.get(chatId);
    if (!chat) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found." });
    if (chat.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });
    await ctx.db.patch(chatId, { skillOverrides, updatedAt: Date.now() });
  },
});

export const setPersonaSkillOverridesInternal = internalMutation({
  args: {
    personaId: v.id("personas"),
    userId: v.string(),
    skillOverrides: v.array(skillOverrideEntry),
  },
  handler: async (ctx, { personaId, userId, skillOverrides }) => {
    const persona = await ctx.db.get(personaId);
    if (!persona) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Persona not found." });
    if (persona.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });
    await ctx.db.patch(personaId, { skillOverrides, updatedAt: Date.now() });
  },
});

export const setChatIntegrationOverridesInternal = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    integrationOverrides: v.array(integrationOverrideEntry),
  },
  handler: async (ctx, { chatId, userId, integrationOverrides }) => {
    const chat = await ctx.db.get(chatId);
    if (!chat) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found." });
    if (chat.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });
    await ctx.db.patch(chatId, { integrationOverrides, updatedAt: Date.now() });
  },
});

export const setPersonaIntegrationOverridesInternal = internalMutation({
  args: {
    personaId: v.id("personas"),
    userId: v.string(),
    integrationOverrides: v.array(integrationOverrideEntry),
  },
  handler: async (ctx, { personaId, userId, integrationOverrides }) => {
    const persona = await ctx.db.get(personaId);
    if (!persona) throw new ConvexError({ code: "NOT_FOUND" as const, message: "Persona not found." });
    if (persona.userId !== userId) throw new ConvexError({ code: "NOT_AUTHORIZED" as const, message: "Not authorized." });
    await ctx.db.patch(personaId, { integrationOverrides, updatedAt: Date.now() });
  },
});

// ── Compilation status update (called from compilation action) ───────────

export const updateCompilationStatus = internalMutation({
  args: {
    skillId: v.id("skills"),
    compilationStatus: v.union(
      v.literal("pending"),
      v.literal("compiled"),
      v.literal("failed"),
    ),
    instructionsCompiled: v.optional(v.string()),
    runtimeMode: v.optional(skillRuntimeModeValidator),
    requiredToolIds: v.optional(v.array(v.string())),
    requiredToolProfiles: v.optional(v.array(skillToolProfile)),
    requiredIntegrationIds: v.optional(v.array(v.string())),
    requiredCapabilities: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      compilationStatus: args.compilationStatus,
      updatedAt: Date.now(),
    };

    if (args.instructionsCompiled !== undefined) {
      updates.instructionsCompiled = args.instructionsCompiled;
    }
    if (args.runtimeMode !== undefined) {
      updates.runtimeMode = args.runtimeMode;
    }
    if (args.requiredToolIds !== undefined) {
      updates.requiredToolIds = args.requiredToolIds;
    }
    if (args.requiredToolProfiles !== undefined) {
      updates.requiredToolProfiles = args.requiredToolProfiles;
    }
    if (args.requiredIntegrationIds !== undefined) {
      updates.requiredIntegrationIds = args.requiredIntegrationIds;
    }
    if (args.requiredCapabilities !== undefined) {
      updates.requiredCapabilities = args.requiredCapabilities;
    }

    await ctx.db.patch(args.skillId, updates);
  },
});
