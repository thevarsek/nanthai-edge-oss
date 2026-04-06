// convex/tools/load_skill.ts
// =============================================================================
// The `load_skill` tool — progressive disclosure entry point.
//
// When the model sees a task that matches a skill from the `<available_skills>`
// catalog in its system prompt, it calls this tool with the skill's slug name.
// The tool returns the full compiled instructions (or trimmed raw fallback).
// =============================================================================

import { internal } from "../_generated/api";
import { createTool } from "./registry";
import { inferProfilesFromToolIds } from "../skills/tool_profiles";

/**
 * `load_skill` — load full instructions for a discoverable skill.
 *
 * The model sees a lightweight catalog in the system prompt and calls this
 * tool on-demand to fetch the full instruction set before executing a
 * skill-related task. This keeps the system prompt small while giving the
 * model access to rich domain knowledge when needed.
 */
export const loadSkill = createTool({
  name: "load_skill",
  description:
    "Load full instructions for a skill by name. Call this when you recognise a task " +
    "that matches one of the skills listed in <available_skills>. Pass the skill's " +
    "<name> value. Returns the full instruction set to follow for that skill.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The skill name (slug) from <available_skills> — e.g. 'doc-coauthoring', 'docx', 'xlsx'.",
      },
    },
    required: ["name"],
  },

  execute: async (toolCtx, args) => {
    const name = args.name as string | undefined;

    if (!name || typeof name !== "string" || !name.trim()) {
      return {
        success: false,
        data: null,
        error: "Missing or empty 'name'. Provide the skill slug from <available_skills>.",
      };
    }

    try {
      const skill = await toolCtx.ctx.runQuery(
        internal.skills.queries.getSkillBySlugForUser,
        { slug: name.trim(), userId: toolCtx.userId },
      );

      if (!skill) {
        return {
          success: false,
          data: null,
          error:
            `No active skill found with name "${name.trim()}". ` +
            `Check <available_skills> for valid skill names.`,
        };
      }

      // Always return raw instructions directly (LLM compilation removed in v1)
      const instructions = skill.instructionsRaw;

      // Use stored profiles, falling back to inference from tool/integration IDs
      // when the DB record predates the requiredToolProfiles field.
      const storedProfiles = skill.requiredToolProfiles ?? [];
      const requiredToolProfiles = storedProfiles.length > 0
        ? storedProfiles
        : inferProfilesFromToolIds(
            skill.requiredToolIds ?? [],
            skill.requiredIntegrationIds ?? [],
          );

      return {
        success: true,
        data: {
          skill: skill.slug,
          name: skill.name,
          runtimeMode: skill.runtimeMode,
          requiredToolIds: skill.requiredToolIds,
          requiredToolProfiles,
          requiredIntegrationIds: skill.requiredIntegrationIds,
          requiredCapabilities: skill.requiredCapabilities ?? [],
          instructions,
        },
      };
    } catch (e) {
      return {
        success: false,
        data: null,
        error: `Failed to load skill: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
