// convex/tools/skill_management.ts
// =============================================================================
// AI tools for skill management: CRUD and assignment to personas/chats.
//
// Tier 1 Pro tools. Let the AI create, update, delete, and assign skills
// conversationally — e.g. "create a skill for writing legal briefs" or
// "enable the XLSX skill for this chat".
//
// Follows the same pattern as `persona.ts`.
// =============================================================================

import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { createTool } from "./registry";
import type { SystemSkillSeedData } from "../skills/mutations_seed";

type SkillToolProfile = NonNullable<SystemSkillSeedData["requiredToolProfiles"]>[number];

type SkillRuntimeMode = "textOnly" | "toolAugmented" | "sandboxAugmented";

function isSkillRuntimeMode(value: string): value is SkillRuntimeMode {
  return value === "textOnly" || value === "toolAugmented" || value === "sandboxAugmented";
}

// ── list_skills ─────────────────────────────────────────────────────────

export const listSkills = createTool({
  name: "list_skills",
  description:
    "List all skills visible to the user (system skills + user-created skills). " +
    "Returns each skill's name, slug, summary, and runtime mode. " +
    "Use this when the user asks what skills are available or wants to browse skills.",
  parameters: {
    type: "object",
    properties: {},
  },

  execute: async (toolCtx) => {
    try {
      const skills = await toolCtx.ctx.runQuery(
        internal.skills.queries.listVisibleSkillsInternal,
        { userId: toolCtx.userId },
      );

      const entries = skills.map((s: Record<string, unknown>) => ({
        id: s._id,
        slug: s.slug,
        name: s.name,
        summary: s.summary,
        runtimeMode: s.runtimeMode,
        requiredToolProfiles: s.requiredToolProfiles ?? [],
        requiredCapabilities: s.requiredCapabilities ?? [],
        scope: s.scope,
        origin: s.origin,
        compilationStatus: s.compilationStatus,
      }));

      return {
        success: true,
        data: {
          skills: entries,
          count: entries.length,
          message:
            entries.length > 0
              ? `Found ${entries.length} skill(s).`
              : "No skills available. You can create custom skills with the create_skill tool.",
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to list skills: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── create_skill ────────────────────────────────────────────────────────

export const createSkill = createTool({
  name: "create_skill",
  description:
    "Create a new custom skill with a name, summary, and instructions. " +
    "Skills provide domain-specific instructions that are loaded on-demand via load_skill. " +
    "Instructions should be clear, actionable guidance the AI follows when the skill is active. " +
    "The skill is automatically compiled after creation. " +
    "Browser automation and MCP references are not supported. Shell and filesystem instructions are only valid for sandboxAugmented skills when the user has workspace runtime access.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Display name for the skill (e.g. 'Legal Brief Writer'). Must be unique per user.",
      },
      summary: {
        type: "string",
        description:
          "Short description (1-2 sentences) of when to use this skill. " +
          "Shown in the skill catalog for discovery.",
      },
      instructionsRaw: {
        type: "string",
        description:
          "Full instruction text the AI should follow when the skill is loaded. " +
          "Be detailed: include domain knowledge, workflow steps, formatting guidelines, " +
          "and constraints. Avoid browser automation or MCP references; shell/filesystem steps are only appropriate for sandboxAugmented skills.",
      },
      runtimeMode: {
        type: "string",
        description:
          "One of 'textOnly', 'toolAugmented', or 'sandboxAugmented'. " +
          "Use 'sandboxAugmented' only for skills that require the temporary code workspace.",
      },
      requiredToolIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Tool IDs this skill requires (e.g. ['generate_docx', 'edit_docx']). " +
          "Only needed for toolAugmented skills.",
      },
      requiredToolProfiles: {
        type: "array",
        items: { type: "string" },
        description:
          "Progressive tool-loading profiles for this skill, such as ['docs'], ['analytics'], " +
          "['workspace'], ['subagents'], ['google'], ['microsoft'], ['notion'], ['appleCalendar'], " +
          "['scheduledJobs'], or ['skillsManagement'].",
      },
      requiredIntegrationIds: {
        type: "array",
        items: { type: "string" },
        description:
          "OAuth integration IDs this skill requires (e.g. ['gmail', 'notion']). " +
          "Only needed if the skill depends on external integrations.",
      },
      requiredCapabilities: {
        type: "array",
        items: { type: "string" },
        description:
          "Capability IDs required by the skill, such as ['sandboxRuntime']. " +
          "Only needed for skills gated on internal Max runtime features.",
      },
    },
    required: ["name", "summary", "instructionsRaw"],
  },

  execute: async (toolCtx, args) => {
    const name = args.name as string | undefined;
    const summary = args.summary as string | undefined;
    const instructionsRaw = args.instructionsRaw as string | undefined;

    if (!name || !name.trim()) {
      return { success: false, data: null, error: "Missing or empty 'name'." };
    }
    if (!summary || !summary.trim()) {
      return { success: false, data: null, error: "Missing or empty 'summary'." };
    }
    if (!instructionsRaw || !instructionsRaw.trim()) {
      return { success: false, data: null, error: "Missing or empty 'instructionsRaw'." };
    }

    // Validate runtimeMode if provided
    const runtimeMode = (args.runtimeMode as string) || "textOnly";
    if (!isSkillRuntimeMode(runtimeMode)) {
      return {
        success: false,
        data: null,
        error: "runtimeMode must be 'textOnly', 'toolAugmented', or 'sandboxAugmented'.",
      };
    }

    try {
      const skillId = await toolCtx.ctx.runMutation(
        internal.skills.mutations.createSkillInternal,
        {
          userId: toolCtx.userId,
          name: name.trim(),
          summary: summary.trim(),
          instructionsRaw,
          runtimeMode,
          requiredToolIds: (args.requiredToolIds as string[]) || undefined,
          requiredToolProfiles: (args.requiredToolProfiles as SkillToolProfile[]) || undefined,
          requiredIntegrationIds: (args.requiredIntegrationIds as string[]) || undefined,
          requiredCapabilities: (args.requiredCapabilities as string[]) || undefined,
        },
      );

      return {
        success: true,
        data: {
          skillId,
          name: name.trim(),
          message:
            `Created skill "${name.trim()}". Metadata and profiles were normalized automatically. ` +
            `The user can assign it to personas or chats, or it can be loaded via load_skill.`,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Surface validation errors cleanly
      if (msg.startsWith("SKILL_INCOMPATIBLE:")) {
        return {
          success: false,
          data: null,
          error:
            `The instructions contain incompatible content. ${msg.replace("SKILL_INCOMPATIBLE: ", "")} ` +
            `Remove references to local shell, filesystem, bash, browser automation, or MCP servers.`,
        };
      }
      return {
        success: false,
        data: null,
        error: `Failed to create skill: ${msg}`,
      };
    }
  },
});

// ── update_skill ────────────────────────────────────────────────────────

export const updateSkill = createTool({
  name: "update_skill",
  description:
    "Update an existing user-created skill. Can modify name, summary, instructions, " +
    "runtime mode, or required tools. System skills cannot be edited — duplicate them first. " +
    "Supports lookup by name (case-insensitive) or skill ID.",
  parameters: {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        description: "The skill's Convex document ID, if known.",
      },
      skillName: {
        type: "string",
        description: "The skill name to search for (case-insensitive).",
      },
      name: {
        type: "string",
        description: "New display name for the skill.",
      },
      summary: {
        type: "string",
        description: "New summary description.",
      },
      instructionsRaw: {
        type: "string",
        description: "New instruction text. Triggers re-compilation.",
      },
      runtimeMode: {
        type: "string",
        description: "'textOnly', 'toolAugmented', or 'sandboxAugmented'.",
      },
      requiredToolIds: {
        type: "array",
        items: { type: "string" },
        description: "Updated list of required tool IDs.",
      },
      requiredToolProfiles: {
        type: "array",
        items: { type: "string" },
        description: "Updated list of progressive tool-loading profile IDs.",
      },
      requiredIntegrationIds: {
        type: "array",
        items: { type: "string" },
        description: "Updated list of required integration IDs.",
      },
      requiredCapabilities: {
        type: "array",
        items: { type: "string" },
        description: "Updated list of required capability IDs.",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const skillId = args.skillId as string | undefined;
    const skillName = args.skillName as string | undefined;

    if (!skillId && !skillName) {
      return {
        success: false,
        data: null,
        error: "Provide either 'skillId' or 'skillName' to identify the skill to update.",
      };
    }

    try {
      // Resolve skill by name if needed
      let resolvedId: Id<"skills"> | null = null;

      if (skillId) {
        resolvedId = skillId as Id<"skills">;
      } else if (skillName) {
        const userSkills = await toolCtx.ctx.runQuery(
          internal.skills.queries.listUserSkillsInternal,
          { userId: toolCtx.userId },
        );
        const needle = skillName.toLowerCase();
        const matches = userSkills.filter((s: Record<string, unknown>) =>
          (s.name as string).toLowerCase().includes(needle),
        );

        if (matches.length === 0) {
          return {
            success: false,
            data: null,
            error: `No user skill found matching "${skillName}".`,
          };
        }
        if (matches.length > 1) {
          const names = matches.map((s: Record<string, unknown>) => s.name);
          return {
            success: false,
            data: { ambiguousMatches: names },
            error: `Multiple skills match "${skillName}": ${names.join(", ")}. Be more specific.`,
          };
        }
        resolvedId = matches[0]._id as Id<"skills">;
      }

      if (!resolvedId) {
        return { success: false, data: null, error: "Could not resolve skill." };
      }

      // Validate runtimeMode if provided
      if (args.runtimeMode !== undefined) {
        const mode = args.runtimeMode as string;
        if (!isSkillRuntimeMode(mode)) {
          return {
            success: false,
            data: null,
            error: "runtimeMode must be 'textOnly', 'toolAugmented', or 'sandboxAugmented'.",
          };
        }
      }

      await toolCtx.ctx.runMutation(
        internal.skills.mutations.updateSkillInternal,
        {
          skillId: resolvedId,
          userId: toolCtx.userId,
          name: (args.name as string) || undefined,
          summary: (args.summary as string) || undefined,
          instructionsRaw: (args.instructionsRaw as string) || undefined,
          runtimeMode: (args.runtimeMode as SkillRuntimeMode) || undefined,
          requiredToolIds: (args.requiredToolIds as string[]) || undefined,
          requiredToolProfiles: (args.requiredToolProfiles as SkillToolProfile[]) || undefined,
          requiredIntegrationIds: (args.requiredIntegrationIds as string[]) || undefined,
          requiredCapabilities: (args.requiredCapabilities as string[]) || undefined,
        },
      );

      return {
        success: true,
        data: {
          skillId: resolvedId,
          message:
            `Updated skill. ${args.instructionsRaw ? "Instructions and profile metadata were revalidated." : ""}`,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("SKILL_INCOMPATIBLE:")) {
        return {
          success: false,
          data: null,
          error: `Incompatible instructions: ${msg.replace("SKILL_INCOMPATIBLE: ", "")}`,
        };
      }
      return { success: false, data: null, error: `Failed to update skill: ${msg}` };
    }
  },
});

// ── delete_skill ────────────────────────────────────────────────────────

export const deleteSkill = createTool({
  name: "delete_skill",
  description:
    "Delete a user-created skill by name or ID. System skills cannot be deleted. " +
    "Supports case-insensitive name lookup.",
  parameters: {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        description: "The skill's Convex document ID, if known.",
      },
      skillName: {
        type: "string",
        description: "The skill name to search for (case-insensitive).",
      },
    },
    required: [],
  },

  execute: async (toolCtx, args) => {
    const skillId = args.skillId as string | undefined;
    const skillName = args.skillName as string | undefined;

    if (!skillId && !skillName) {
      return {
        success: false,
        data: null,
        error: "Provide either 'skillId' or 'skillName' to identify the skill to delete.",
      };
    }

    try {
      let resolvedId: Id<"skills"> | null = null;
      let resolvedName = "";

      if (skillId) {
        resolvedId = skillId as Id<"skills">;
      } else if (skillName) {
        const userSkills = await toolCtx.ctx.runQuery(
          internal.skills.queries.listUserSkillsInternal,
          { userId: toolCtx.userId },
        );
        const needle = skillName.toLowerCase();
        const matches = userSkills.filter((s: Record<string, unknown>) =>
          (s.name as string).toLowerCase().includes(needle),
        );

        if (matches.length === 0) {
          return { success: false, data: null, error: `No user skill found matching "${skillName}".` };
        }
        if (matches.length > 1) {
          const names = matches.map((s: Record<string, unknown>) => s.name);
          return {
            success: false,
            data: { ambiguousMatches: names },
            error: `Multiple skills match "${skillName}": ${names.join(", ")}. Be more specific.`,
          };
        }
        resolvedId = matches[0]._id as Id<"skills">;
        resolvedName = matches[0].name as string;
      }

      if (!resolvedId) {
        return { success: false, data: null, error: "Could not resolve skill to delete." };
      }

      await toolCtx.ctx.runMutation(
        internal.skills.mutations.deleteSkillInternal,
        { skillId: resolvedId, userId: toolCtx.userId },
      );

      return {
        success: true,
        data: {
          deletedSkillId: resolvedId as string,
          deletedSkillName: resolvedName,
          message: `Deleted skill${resolvedName ? ` "${resolvedName}"` : ""}.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to delete skill: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── enable_skill_for_chat ───────────────────────────────────────────────

export const enableSkillForChat = createTool({
  name: "enable_skill_for_chat",
  description:
    "Enable a skill for the current chat by adding it to the chat's discoverable skills. " +
    "The skill will appear in the model's <available_skills> catalog for this chat. " +
    "Accepts a skill slug or name.",
  parameters: {
    type: "object",
    properties: {
      chatId: {
        type: "string",
        description: "The chat ID to enable the skill for.",
      },
      skillSlug: {
        type: "string",
        description: "The skill slug (from <available_skills>) to enable.",
      },
    },
    required: ["chatId", "skillSlug"],
  },

  execute: async (toolCtx, args) => {
    const chatId = args.chatId as string | undefined;
    const skillSlug = args.skillSlug as string | undefined;

    if (!chatId) return { success: false, data: null, error: "Missing 'chatId'." };
    if (!skillSlug) return { success: false, data: null, error: "Missing 'skillSlug'." };

    try {
      // Look up the skill by slug
      const skill = await toolCtx.ctx.runQuery(
        internal.skills.queries.getSkillBySlugForUser,
        { slug: skillSlug.trim(), userId: toolCtx.userId },
      );
      if (!skill) {
        return { success: false, data: null, error: `No skill found with slug "${skillSlug}".` };
      }

      // Get current chat skills
      const chat = await toolCtx.ctx.runQuery(
        internal.chat.queries.getChatInternal,
        { chatId: chatId as Id<"chats"> },
      );
      if (!chat) {
        return { success: false, data: null, error: "Chat not found." };
      }
      if ((chat as Record<string, unknown>).userId !== toolCtx.userId) {
        return { success: false, data: null, error: "Not authorized to modify this chat." };
      }

      const currentIds: string[] = ((chat as Record<string, unknown>).discoverableSkillIds as string[]) ?? [];
      const disabledIds: string[] = ((chat as Record<string, unknown>).disabledSkillIds as string[]) ?? [];
      const skillIdStr = String(skill._id);

      if (currentIds.includes(skillIdStr)) {
        return {
          success: true,
          data: { message: `Skill "${skill.name}" is already enabled for this chat.` },
        };
      }

      // Add to discoverable and also remove from disabled (if present)
      const newDisabledIds = disabledIds.filter((id) => id !== skillIdStr);
      await toolCtx.ctx.runMutation(
        internal.skills.mutations.setChatSkills,
        {
          chatId: chatId as Id<"chats">,
          userId: toolCtx.userId,
          discoverableSkillIds: [...currentIds, skill._id] as Id<"skills">[],
          disabledSkillIds: newDisabledIds as Id<"skills">[],
        },
      );

      return {
        success: true,
        data: {
          skillId: skill._id,
          skillName: skill.name,
          message: `Enabled skill "${skill.name}" for this chat.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to enable skill for chat: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── disable_skill_for_chat ──────────────────────────────────────────────

export const disableSkillForChat = createTool({
  name: "disable_skill_for_chat",
  description:
    "Disable a skill for the current chat by adding it to the chat's disabled list. " +
    "The skill will no longer appear in <available_skills> for this chat. " +
    "Accepts a skill slug or name.",
  parameters: {
    type: "object",
    properties: {
      chatId: {
        type: "string",
        description: "The chat ID to disable the skill for.",
      },
      skillSlug: {
        type: "string",
        description: "The skill slug to disable.",
      },
    },
    required: ["chatId", "skillSlug"],
  },

  execute: async (toolCtx, args) => {
    const chatId = args.chatId as string | undefined;
    const skillSlug = args.skillSlug as string | undefined;

    if (!chatId) return { success: false, data: null, error: "Missing 'chatId'." };
    if (!skillSlug) return { success: false, data: null, error: "Missing 'skillSlug'." };

    try {
      const skill = await toolCtx.ctx.runQuery(
        internal.skills.queries.getSkillBySlugForUser,
        { slug: skillSlug.trim(), userId: toolCtx.userId },
      );
      if (!skill) {
        return { success: false, data: null, error: `No skill found with slug "${skillSlug}".` };
      }

      const chat = await toolCtx.ctx.runQuery(
        internal.chat.queries.getChatInternal,
        { chatId: chatId as Id<"chats"> },
      );
      if (!chat) {
        return { success: false, data: null, error: "Chat not found." };
      }
      if ((chat as Record<string, unknown>).userId !== toolCtx.userId) {
        return { success: false, data: null, error: "Not authorized to modify this chat." };
      }

      const disabledIds: string[] = ((chat as Record<string, unknown>).disabledSkillIds as string[]) ?? [];
      const discoverableIds: string[] = ((chat as Record<string, unknown>).discoverableSkillIds as string[]) ?? [];
      const skillIdStr = String(skill._id);

      if (disabledIds.includes(skillIdStr)) {
        return {
          success: true,
          data: { message: `Skill "${skill.name}" is already disabled for this chat.` },
        };
      }

      // Add to disabled and also remove from discoverable (if present)
      const newDiscoverableIds = discoverableIds.filter((id) => id !== skillIdStr);
      await toolCtx.ctx.runMutation(
        internal.skills.mutations.setChatSkills,
        {
          chatId: chatId as Id<"chats">,
          userId: toolCtx.userId,
          disabledSkillIds: [...disabledIds, skill._id] as Id<"skills">[],
          discoverableSkillIds: newDiscoverableIds as Id<"skills">[],
        },
      );

      return {
        success: true,
        data: {
          skillId: skill._id,
          skillName: skill.name,
          message: `Disabled skill "${skill.name}" for this chat.`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to disable skill for chat: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── assign_skill_to_persona ─────────────────────────────────────────────

export const assignSkillToPersona = createTool({
  name: "assign_skill_to_persona",
  description:
    "Assign a skill to a persona so it appears in <available_skills> for any chat " +
    "using that persona. Accepts skill slug and persona name or ID.",
  parameters: {
    type: "object",
    properties: {
      personaName: {
        type: "string",
        description: "The persona name (case-insensitive lookup).",
      },
      personaId: {
        type: "string",
        description: "The persona's Convex document ID, if known.",
      },
      skillSlug: {
        type: "string",
        description: "The skill slug to assign.",
      },
    },
    required: ["skillSlug"],
  },

  execute: async (toolCtx, args) => {
    const personaId = args.personaId as string | undefined;
    const personaName = args.personaName as string | undefined;
    const skillSlug = args.skillSlug as string | undefined;

    if (!personaId && !personaName) {
      return { success: false, data: null, error: "Provide either 'personaId' or 'personaName'." };
    }
    if (!skillSlug) return { success: false, data: null, error: "Missing 'skillSlug'." };

    try {
      // Resolve skill
      const skill = await toolCtx.ctx.runQuery(
        internal.skills.queries.getSkillBySlugForUser,
        { slug: skillSlug.trim(), userId: toolCtx.userId },
      );
      if (!skill) {
        return { success: false, data: null, error: `No skill found with slug "${skillSlug}".` };
      }

      // Resolve persona
      const personas = await toolCtx.ctx.runQuery(
        internal.personas.queries.listPersonasInternal,
        { userId: toolCtx.userId },
      );

      let target: Record<string, unknown> | null = null;
      if (personaId) {
        target = personas.find((p: Record<string, unknown>) => p._id === personaId) ?? null;
      } else if (personaName) {
        const needle = personaName.toLowerCase();
        const matches = personas.filter((p: Record<string, unknown>) =>
          (p.displayName as string).toLowerCase().includes(needle),
        );
        if (matches.length === 0) {
          return { success: false, data: null, error: `No persona found matching "${personaName}".` };
        }
        if (matches.length > 1) {
          return {
            success: false,
            data: { ambiguousMatches: matches.map((p: Record<string, unknown>) => p.displayName) },
            error: `Multiple personas match. Be more specific.`,
          };
        }
        target = matches[0];
      }

      if (!target) return { success: false, data: null, error: "Could not resolve persona." };

      const targetId = target._id as Id<"personas">;
      const currentIds: string[] = (target.discoverableSkillIds as string[]) ?? [];
      const skillIdStr = String(skill._id);

      if (currentIds.includes(skillIdStr)) {
        return {
          success: true,
          data: { message: `Skill "${skill.name}" is already assigned to persona "${target.displayName}".` },
        };
      }

      await toolCtx.ctx.runMutation(
        internal.skills.mutations.setPersonaSkills,
        {
          personaId: targetId,
          userId: toolCtx.userId,
          discoverableSkillIds: [...currentIds, skill._id] as Id<"skills">[],
        },
      );

      return {
        success: true,
        data: {
          personaId: targetId,
          skillId: skill._id,
          message: `Assigned skill "${skill.name}" to persona "${target.displayName}".`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to assign skill to persona: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// ── remove_skill_from_persona ───────────────────────────────────────────

export const removeSkillFromPersona = createTool({
  name: "remove_skill_from_persona",
  description:
    "Remove a skill assignment from a persona. The skill will no longer be " +
    "automatically discoverable in chats using this persona.",
  parameters: {
    type: "object",
    properties: {
      personaName: {
        type: "string",
        description: "The persona name (case-insensitive lookup).",
      },
      personaId: {
        type: "string",
        description: "The persona's Convex document ID, if known.",
      },
      skillSlug: {
        type: "string",
        description: "The skill slug to remove.",
      },
    },
    required: ["skillSlug"],
  },

  execute: async (toolCtx, args) => {
    const personaId = args.personaId as string | undefined;
    const personaName = args.personaName as string | undefined;
    const skillSlug = args.skillSlug as string | undefined;

    if (!personaId && !personaName) {
      return { success: false, data: null, error: "Provide either 'personaId' or 'personaName'." };
    }
    if (!skillSlug) return { success: false, data: null, error: "Missing 'skillSlug'." };

    try {
      // Resolve skill
      const skill = await toolCtx.ctx.runQuery(
        internal.skills.queries.getSkillBySlugForUser,
        { slug: skillSlug.trim(), userId: toolCtx.userId },
      );
      if (!skill) {
        return { success: false, data: null, error: `No skill found with slug "${skillSlug}".` };
      }

      // Resolve persona
      const personas = await toolCtx.ctx.runQuery(
        internal.personas.queries.listPersonasInternal,
        { userId: toolCtx.userId },
      );

      let target: Record<string, unknown> | null = null;
      if (personaId) {
        target = personas.find((p: Record<string, unknown>) => p._id === personaId) ?? null;
      } else if (personaName) {
        const needle = personaName.toLowerCase();
        const matches = personas.filter((p: Record<string, unknown>) =>
          (p.displayName as string).toLowerCase().includes(needle),
        );
        if (matches.length === 0) {
          return { success: false, data: null, error: `No persona found matching "${personaName}".` };
        }
        if (matches.length > 1) {
          return {
            success: false,
            data: { ambiguousMatches: matches.map((p: Record<string, unknown>) => p.displayName) },
            error: `Multiple personas match. Be more specific.`,
          };
        }
        target = matches[0];
      }

      if (!target) return { success: false, data: null, error: "Could not resolve persona." };

      const targetId = target._id as Id<"personas">;
      const currentIds: string[] = (target.discoverableSkillIds as string[]) ?? [];
      const skillIdStr = String(skill._id);

      const newIds = currentIds.filter((id) => id !== skillIdStr);
      if (newIds.length === currentIds.length) {
        return {
          success: true,
          data: { message: `Skill "${skill.name}" was not assigned to persona "${target.displayName}".` },
        };
      }

      await toolCtx.ctx.runMutation(
        internal.skills.mutations.setPersonaSkills,
        {
          personaId: targetId,
          userId: toolCtx.userId,
          discoverableSkillIds: newIds as Id<"skills">[],
        },
      );

      return {
        success: true,
        data: {
          personaId: targetId,
          skillId: skill._id,
          message: `Removed skill "${skill.name}" from persona "${target.displayName}".`,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to remove skill from persona: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
