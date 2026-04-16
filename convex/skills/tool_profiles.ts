import type { ValidationFinding } from "./validators";

const PROFILE_ORDER = [
  "docs",
  "analytics",
  "workspace",
  "persistentRuntime",
  "subagents",
  "google",
  "microsoft",
  "notion",
  "appleCalendar",
  "scheduledJobs",
  "skillsManagement",
  "personas",
] as const;

export type SkillToolProfileId = typeof PROFILE_ORDER[number];
type SkillRuntimeMode = "textOnly" | "toolAugmented" | "sandboxAugmented";

export interface SkillMetadataInput {
  instructionsRaw?: string;
  runtimeMode: SkillRuntimeMode;
  requiredToolIds: string[];
  requiredIntegrationIds: string[];
  requiredCapabilities: string[];
  requiredToolProfiles?: string[];
}

export interface SkillMetadataNormalizationResult {
  runtimeMode: SkillRuntimeMode;
  requiredToolIds: string[];
  requiredIntegrationIds: string[];
  requiredCapabilities: string[];
  requiredToolProfiles: SkillToolProfileId[];
  metadataWarnings: string[];
}

const DOC_TOOL_IDS = new Set([
  "generate_docx", "read_docx", "edit_docx",
  "generate_pptx", "read_pptx", "edit_pptx",
  "generate_xlsx", "read_xlsx", "edit_xlsx",
  "generate_text_file", "read_text_file",
  "generate_eml", "read_eml",
]);

const ANALYTICS_TOOL_IDS = new Set([
  "workspace_import_file",
  "data_python_exec",
  "data_python_sandbox",
]);

const WORKSPACE_TOOL_IDS = new Set([
  "workspace_exec",
  "workspace_list_files",
  "workspace_read_file",
  "workspace_write_file",
  "workspace_make_dirs",
  "workspace_export_file",
  "workspace_reset",
]);

const PERSISTENT_RUNTIME_TOOL_IDS = new Set([
  "vm_exec",
  "vm_list_files",
  "vm_read_file",
  "vm_write_file",
  "vm_delete_file",
  "vm_make_dirs",
  "vm_import_file",
  "vm_export_file",
  "vm_reset",
  "read_pdf",
  "generate_pdf",
  "edit_pdf",
]);

const SUBAGENT_TOOL_IDS = new Set([
  "spawn_subagents",
]);

const SCHEDULED_JOB_TOOL_IDS = new Set([
  "create_scheduled_job",
  "list_scheduled_jobs",
  "update_scheduled_job",
  "delete_scheduled_job",
]);

const SKILL_MANAGEMENT_TOOL_IDS = new Set([
  "create_skill",
  "update_skill",
  "delete_skill",
  "list_skills",
  "enable_skill_for_chat",
  "disable_skill_for_chat",
  "assign_skill_to_persona",
  "remove_skill_from_persona",
]);

const PERSONA_TOOL_IDS = new Set([
  "create_persona",
  "delete_persona",
]);

const INTEGRATION_PROFILE_BY_ID: Record<string, SkillToolProfileId> = {
  gmail: "google",
  drive: "google",
  calendar: "google",
  outlook: "microsoft",
  onedrive: "microsoft",
  ms_calendar: "microsoft",
  notion: "notion",
  apple_calendar: "appleCalendar",
};

export function validateToolProfileIds(ids: string[]): string[] {
  const known = new Set(PROFILE_ORDER);
  return ids.filter((id) => !known.has(id as SkillToolProfileId));
}

/**
 * Lightweight inference: derive tool profiles purely from requiredToolIds and
 * requiredIntegrationIds. Does NOT validate integration availability or throw.
 *
 * Used as a runtime fallback when `requiredToolProfiles` is missing from
 * the database record (e.g. skills seeded before the field was added).
 */
export function inferProfilesFromToolIds(
  requiredToolIds: string[],
  requiredIntegrationIds: string[] = [],
): SkillToolProfileId[] {
  const profiles = new Set<SkillToolProfileId>();

  for (const toolId of requiredToolIds) {
    if (DOC_TOOL_IDS.has(toolId)) profiles.add("docs");
    if (ANALYTICS_TOOL_IDS.has(toolId)) profiles.add("analytics");
    if (WORKSPACE_TOOL_IDS.has(toolId)) profiles.add("workspace");
    if (PERSISTENT_RUNTIME_TOOL_IDS.has(toolId)) profiles.add("persistentRuntime");
    if (SUBAGENT_TOOL_IDS.has(toolId)) profiles.add("subagents");
    if (SCHEDULED_JOB_TOOL_IDS.has(toolId)) profiles.add("scheduledJobs");
    if (SKILL_MANAGEMENT_TOOL_IDS.has(toolId)) profiles.add("skillsManagement");
    if (PERSONA_TOOL_IDS.has(toolId)) profiles.add("personas");
  }

  for (const integrationId of requiredIntegrationIds) {
    const profile = INTEGRATION_PROFILE_BY_ID[integrationId];
    if (profile) profiles.add(profile);
  }

  return sortProfiles(Array.from(profiles));
}

export function normalizeSkillMetadata(
  input: SkillMetadataInput,
  findings: ValidationFinding[] = [],
): SkillMetadataNormalizationResult {
  const requiredToolIds = uniqueSorted(input.requiredToolIds);
  const requiredIntegrationIds = uniqueSorted(input.requiredIntegrationIds);
  const requiredCapabilities = new Set(
    input.requiredCapabilities,
  );
  const inferredProfiles = new Set<SkillToolProfileId>(
    (input.requiredToolProfiles ?? []).filter(Boolean) as SkillToolProfileId[],
  );
  const metadataWarnings: string[] = [];

  for (const toolId of requiredToolIds) {
    if (DOC_TOOL_IDS.has(toolId)) inferredProfiles.add("docs");
    if (ANALYTICS_TOOL_IDS.has(toolId)) inferredProfiles.add("analytics");
    if (WORKSPACE_TOOL_IDS.has(toolId)) inferredProfiles.add("workspace");
    if (PERSISTENT_RUNTIME_TOOL_IDS.has(toolId)) inferredProfiles.add("persistentRuntime");
    if (SUBAGENT_TOOL_IDS.has(toolId)) inferredProfiles.add("subagents");
    if (SCHEDULED_JOB_TOOL_IDS.has(toolId)) inferredProfiles.add("scheduledJobs");
    if (SKILL_MANAGEMENT_TOOL_IDS.has(toolId)) inferredProfiles.add("skillsManagement");
    if (PERSONA_TOOL_IDS.has(toolId)) inferredProfiles.add("personas");
  }

  for (const integrationId of requiredIntegrationIds) {
    const profile = INTEGRATION_PROFILE_BY_ID[integrationId];
    if (profile) inferredProfiles.add(profile);
  }

  for (const token of extractExplicitMetadataTokens(input.instructionsRaw ?? "")) {
    if (DOC_TOOL_IDS.has(token)) inferredProfiles.add("docs");
    if (ANALYTICS_TOOL_IDS.has(token)) inferredProfiles.add("analytics");
    if (WORKSPACE_TOOL_IDS.has(token)) inferredProfiles.add("workspace");
    if (PERSISTENT_RUNTIME_TOOL_IDS.has(token)) inferredProfiles.add("persistentRuntime");
    if (SUBAGENT_TOOL_IDS.has(token)) inferredProfiles.add("subagents");
    if (SCHEDULED_JOB_TOOL_IDS.has(token)) inferredProfiles.add("scheduledJobs");
    if (SKILL_MANAGEMENT_TOOL_IDS.has(token)) inferredProfiles.add("skillsManagement");
    const profile = INTEGRATION_PROFILE_BY_ID[token];
    if (profile) inferredProfiles.add(profile);
  }

  let runtimeMode = input.runtimeMode;
  if (inferredProfiles.has("analytics") || inferredProfiles.has("workspace")) {
    runtimeMode = "toolAugmented";
  } else if (runtimeMode === "sandboxAugmented" && inferredProfiles.size === 0) {
    inferredProfiles.add("workspace");
  }

  pruneOrphanedIntegrationProfiles(inferredProfiles, requiredIntegrationIds, metadataWarnings);

  if (inferredProfiles.has("docs") && !requiredToolIds.some((toolId) => DOC_TOOL_IDS.has(toolId))) {
    metadataWarnings.push(
      "Documents profile is enabled without document tool IDs; this skill will rely on profile-based tool loading.",
    );
  }
  if (inferredProfiles.has("analytics") && !requiredToolIds.some((toolId) => ANALYTICS_TOOL_IDS.has(toolId))) {
    metadataWarnings.push(
      "Analytics profile is enabled without analytics tool IDs; this skill will rely on profile-based tool loading.",
    );
  }
  if (inferredProfiles.has("workspace") && !requiredToolIds.some((toolId) => WORKSPACE_TOOL_IDS.has(toolId))) {
    metadataWarnings.push(
      "Workspace profile is enabled without explicit workspace tool IDs; this skill will rely on profile-based tool loading.",
    );
  }
  if (inferredProfiles.has("persistentRuntime") && !requiredToolIds.some((toolId) => PERSISTENT_RUNTIME_TOOL_IDS.has(toolId))) {
    metadataWarnings.push(
      "Persistent runtime profile is enabled without explicit VM/PDF tool IDs; this skill will rely on profile-based tool loading.",
    );
  }
  if (inferredProfiles.has("subagents") && !requiredToolIds.some((toolId) => SUBAGENT_TOOL_IDS.has(toolId))) {
    metadataWarnings.push(
      "Subagents profile is enabled without explicit subagent tool IDs; this skill will rely on profile-based tool loading.",
    );
  }

  for (const finding of findings) {
    if (finding.severity !== "warning") continue;
    if (finding.code === "USES_FILESYSTEM" || finding.code === "USES_BASH") {
      metadataWarnings.push(
        "Skill instructions reference filesystem or shell steps. NanthAI only supports them through workspace/runtime-enabled skills.",
      );
      break;
    }
  }

  return {
    runtimeMode,
    requiredToolIds,
    requiredIntegrationIds,
    requiredCapabilities: uniqueSorted(Array.from(requiredCapabilities)),
    requiredToolProfiles: sortProfiles(Array.from(inferredProfiles)),
    metadataWarnings: uniqueSorted(metadataWarnings),
  };
}

/**
 * Auto-remove integration profiles that have no backing integration IDs
 * selected. This can happen when the instruction text mentions an integration
 * keyword (e.g. "outlook") but the user explicitly deselected all integrations
 * for that provider. Instead of blocking the save, we silently drop the
 * orphaned profile and add a metadata warning so the user knows what happened.
 */
function pruneOrphanedIntegrationProfiles(
  inferredProfiles: Set<SkillToolProfileId>,
  requiredIntegrationIds: string[],
  metadataWarnings: string[],
): void {
  const integrationProfilePairs: Array<{
    profile: SkillToolProfileId;
    label: string;
  }> = [
    { profile: "google", label: "Google" },
    { profile: "microsoft", label: "Microsoft" },
    { profile: "notion", label: "Notion" },
    { profile: "appleCalendar", label: "Apple Calendar" },
  ];

  for (const { profile, label } of integrationProfilePairs) {
    if (
      inferredProfiles.has(profile) &&
      !requiredIntegrationIds.some(
        (id) => INTEGRATION_PROFILE_BY_ID[id] === profile,
      )
    ) {
      inferredProfiles.delete(profile);
      metadataWarnings.push(
        `${label} profile was inferred from instructions but no ${label} integrations are enabled — profile removed.`,
      );
    }
  }
}

function extractExplicitMetadataTokens(raw: string): string[] {
  return raw
    .split(/[^A-Za-z0-9_]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function sortProfiles(values: SkillToolProfileId[]): SkillToolProfileId[] {
  const unique = [...new Set(values)];
  return unique.sort((a, b) => PROFILE_ORDER.indexOf(a) - PROFILE_ORDER.indexOf(b));
}
