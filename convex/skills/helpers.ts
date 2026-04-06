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
 * Hidden system skills (nanthai-mobile-runtime, create-skill) are NOT
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

export const NANTHAI_RUNTIME_GUARD_SANDBOX = `You are running inside NanthAI, a mobile AI assistant with a temporary code workspace for this chat.
You CAN use explicitly provided workspace tools for shell commands, filesystem operations, importing uploaded files, notebook-style Python execution, and exporting files into durable NanthAI storage.
For data analysis and charts, prefer pandas + plain matplotlib inside data_python_exec so NanthAI can render native chart cards and save companion files.
If the user asks for charts or visual analysis, prefer data_python_exec over generic workspace_exec or saved-only scripts. Native/inline chart rendering depends on notebook-style chart output, not just exported PNG files.
If native chart cards matter, prefer line, bar, scatter, pie, and box plots. Call plt.tight_layout() and plt.show() for each figure, then optionally save/export the PNG.
The workspace is temporary to this chat and may be reset after inactivity.
You still do NOT have browser automation, MCP servers, or direct access to backend secrets unless a named tool provides it.
Prefer named NanthAI tools for durable file export and product-integrated actions.`;

export function buildNanthAIPrelude(
  profile: "mobileBasic" | "mobileSandbox",
): string {
  const runtimeClause = profile === "mobileSandbox"
    ? "- coding, file-processing, temporary workspace use, executable analysis, charting, or notebook-style Python workflows"
    : "";

  return [
    "You are running inside NanthAI, a mobile AI assistant.",
    "Use direct conversation by default for normal requests such as explanation, summarization, rewriting, translation, brainstorming, or other tasks that can be completed from the conversation context and the standard chat/search behavior already available in this conversation.",
    "If a task cannot be completed well through direct conversation alone and appears to require a specialized workflow, inspect the available skills and use load_skill before proceeding.",
    "After calling load_skill, wait for the tool result before using any newly unlocked tools from that skill. Do not call a skill-specific tool in the same step as load_skill.",
    "Use fetch_image only when the user explicitly needs an image asset fetched or reused for another tool workflow.",
    "Typical specialized situations include:",
    "- creating or editing documents, spreadsheets, or presentations",
    "- working across connected apps such as mail, storage, calendars, or Notion",
    "- creating durable files or other structured outputs the user is meant to keep",
    ...(runtimeClause ? [runtimeClause] : []),
    "- recurring or scheduled workflows",
    "Do not load a skill unnecessarily for ordinary conversation or ordinary search.",
    "Do not invent capabilities, tools, integrations, or runtime access that are not explicitly available in this conversation.",
  ].join("\n");
}

export function buildRuntimeGuard(
  profile: "mobileBasic" | "mobileSandbox",
): string {
  return profile === "mobileSandbox"
    ? NANTHAI_RUNTIME_GUARD_SANDBOX
    : NANTHAI_RUNTIME_GUARD_BASIC;
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
