// convex/skills/helpers.ts
// =============================================================================
// Helpers for building the skill catalog and formatting catalog XML.
//
// Used by the generation pipeline (prompt assembly) to inject skill metadata
// into the system prompt via progressive disclosure.
// =============================================================================

import { Id, Doc } from "../_generated/dataModel";

/** Lightweight skill metadata for the catalog. */
export interface SkillCatalogEntry {
  _id: Id<"skills">;
  slug: string;
  name: string;
  summary: string;
  runtimeMode: string;
  requiredToolIds: string[];
  requiredToolProfiles: string[];
  requiredIntegrationIds: string[];
  requiredCapabilities?: string[];
}

export interface SkillCatalogAvailability {
  availableCapabilities?: string[];
  availableIntegrationIds?: string[];
  availableProfiles?: string[];
}

/**
 * Build the discoverable skill catalog for a participant.
 *
 * Catalog = system visible skills
 *   UNION persona discoverable skills
 *   UNION chat discoverable skills
 *   MINUS chat disabled skills
 *
 * Hidden system skills (nanthai-mobile-runtime) are NOT
 * included in the catalog XML — they have separate injection paths.
 */
export function buildSkillCatalogFromDocs(
  systemSkills: Doc<"skills">[],
  personaDiscoverableSkills: Doc<"skills">[],
  chatDiscoverableSkills: Doc<"skills">[],
  disabledSkillIds: Id<"skills">[],
  availability: SkillCatalogAvailability = {},
): SkillCatalogEntry[] {
  const disabledSet = new Set(disabledSkillIds.map(String));
  const seen = new Set<string>();
  const capabilitySet = new Set(availability.availableCapabilities ?? []);
  const integrationSet = new Set(availability.availableIntegrationIds ?? []);
  const profileSet = new Set(availability.availableProfiles ?? []);
  const catalog: SkillCatalogEntry[] = [];

  const addSkill = (skill: Doc<"skills">) => {
    const idStr = String(skill._id);
    if (seen.has(idStr) || disabledSet.has(idStr)) return;
    // Only visible skills go in the catalog
    if (skill.visibility !== "visible") return;
    if (skill.status !== "active") return;
    const requiredCapabilities = skill.requiredCapabilities ?? [];
    if (requiredCapabilities.some((capability) => !capabilitySet.has(capability))) {
      return;
    }
    const requiredProfiles = skill.requiredToolProfiles ?? [];
    if (
      requiredProfiles.length > 0 &&
      availability.availableProfiles !== undefined &&
      !requiredProfiles.some((profile) => profileSet.has(profile))
    ) {
      return;
    }
    const requiredIntegrations = skill.requiredIntegrationIds ?? [];
    if (
      requiredIntegrations.length > 0 &&
      availability.availableIntegrationIds !== undefined &&
      !requiredIntegrations.some((integrationId) => integrationSet.has(integrationId))
    ) {
      return;
    }

    seen.add(idStr);
    catalog.push({
      _id: skill._id,
      slug: skill.slug,
      name: skill.name,
      summary: skill.summary,
      runtimeMode: skill.runtimeMode,
      requiredToolIds: skill.requiredToolIds,
      requiredToolProfiles: skill.requiredToolProfiles ?? [],
      requiredIntegrationIds: skill.requiredIntegrationIds,
      requiredCapabilities: skill.requiredCapabilities ?? [],
    });
  };

  // System visible skills
  for (const skill of systemSkills) {
    addSkill(skill);
  }

  // Persona discoverable skills
  for (const skill of personaDiscoverableSkills) {
    addSkill(skill);
  }

  // Chat discoverable skills
  for (const skill of chatDiscoverableSkills) {
    addSkill(skill);
  }

  return catalog;
}

/**
 * Format the skill catalog as XML for system prompt injection.
 *
 * Produces the `<available_skills>` block that the model sees in every
 * request where at least one skill is discoverable. ~100 tokens per skill.
 */
export function formatSkillCatalogXml(skills: SkillCatalogEntry[]): string {
  if (skills.length === 0) return "";

  const entries = skills.map((skill) => {
    const toolNote = skill.requiredToolIds.length > 0
      ? `\n    <requires_tools>${skill.requiredToolIds.join(", ")}</requires_tools>`
      : "";
    const profileNote = skill.requiredToolProfiles.length > 0
      ? `\n    <requires_profiles>${skill.requiredToolProfiles.join(", ")}</requires_profiles>`
      : "";
    const integrationNote = skill.requiredIntegrationIds.length > 0
      ? `\n    <requires_integrations>${skill.requiredIntegrationIds.join(", ")}</requires_integrations>`
      : "";
    const capabilityNote = skill.requiredCapabilities && skill.requiredCapabilities.length > 0
      ? `\n    <requires_capabilities>${skill.requiredCapabilities.join(", ")}</requires_capabilities>`
      : "";

    return `  <skill>
    <name>${escapeXml(skill.slug)}</name>
    <description>${escapeXml(skill.summary)}</description>${toolNote}${profileNote}${integrationNote}${capabilityNote}
  </skill>`;
  });

  return `<available_skills>\n${entries.join("\n")}\n</available_skills>`;
}

/**
 * The runtime guard text injected into the system prompt when skills are active.
 * NOT loaded via load_skill — always present when catalog is non-empty.
 */
export const NANTHAI_RUNTIME_GUARD_BASIC = `You are running inside NanthAI, a mobile AI assistant. You do NOT have access to:
- Local shell, bash, terminal, or command-line tools
- Local filesystem read/write
- Browser automation, screenshots, or desktop control
- MCP servers or external process management
- Raw HTTP fetches outside of named NanthAI tools
You CAN use any tools explicitly provided in this conversation's tool list.
Do not suggest workarounds involving capabilities you lack.`;

export function buildNanthAIPrelude(
  _profile: "mobileBasic",
): string {
  return [
    "You are running inside NanthAI, a mobile AI assistant.",
    "Use direct conversation by default for normal requests such as explanation, summarization, rewriting, translation, brainstorming, or other tasks that can be completed from the conversation context and the standard chat/search behavior already available in this conversation.",
    "If a task cannot be completed well through direct conversation alone and appears to require a specialized workflow, inspect the available skills and use load_skill before proceeding.",
    "After calling load_skill, wait for the tool result before using any newly unlocked tools from that skill. Do not call a skill-specific tool in the same step as load_skill.",
    "Use fetch_image only when the user explicitly needs an image asset fetched or reused for another tool workflow.",
    "Typical specialized situations include:",
    "- analyzing data, creating charts or graphs, plotting, or running Python code",
    "- creating or editing documents, spreadsheets, or presentations",
    "- working across connected apps such as mail, storage, calendars, or Notion",
    "- creating durable files or other structured outputs the user is meant to keep",
    "- setting up recurring or scheduled AI jobs (daily summaries, reminders, automations)",
    "- creating or managing personas (custom AI personalities)",
    "- creating, editing, or managing skills (custom instruction sets)",
    "Do not load a skill unnecessarily for ordinary conversation or ordinary search.",
    "Do not invent capabilities, tools, integrations, or runtime access that are not explicitly available in this conversation.",
  ].join("\n");
}

export function buildRuntimeGuard(
  _profile: "mobileBasic",
): string {
  return NANTHAI_RUNTIME_GUARD_BASIC;
}

/**
 * The instruction appended after the catalog XML telling the model how to use skills.
 */
export const SKILL_DISCOVERY_INSTRUCTION =
  "When a task matches a skill's description, call the load_skill tool to load its full instructions before proceeding.";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
