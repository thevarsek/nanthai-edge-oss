import type { ValidationFinding } from "./validators";

const PROFILE_ORDER = [
  "docs",
  "analytics",
  "workspace",
  "subagents",
  "google",
  "microsoft",
  "notion",
  "appleCalendar",
  "scheduledJobs",
  "skillsManagement",
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
  allowSandboxRuntime: boolean;
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

const SUBAGENT_TOOL_IDS = new Set([
  "spawn_subagents",
]);

const SCHEDULED_JOB_TOOL_IDS = new Set([
  "create_scheduled_job",
  "list_scheduled_jobs",
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
    if (SUBAGENT_TOOL_IDS.has(toolId)) profiles.add("subagents");
    if (SCHEDULED_JOB_TOOL_IDS.has(toolId)) profiles.add("scheduledJobs");
    if (SKILL_MANAGEMENT_TOOL_IDS.has(toolId)) profiles.add("skillsManagement");
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
  const requiredCapabilities = new Set(input.requiredCapabilities);
  const inferredProfiles = new Set<SkillToolProfileId>(
    (input.requiredToolProfiles ?? []).filter(Boolean) as SkillToolProfileId[],
  );
  const metadataWarnings: string[] = [];

  for (const toolId of requiredToolIds) {
    if (DOC_TOOL_IDS.has(toolId)) inferredProfiles.add("docs");
    if (ANALYTICS_TOOL_IDS.has(toolId)) inferredProfiles.add("analytics");
    if (WORKSPACE_TOOL_IDS.has(toolId)) inferredProfiles.add("workspace");
    if (SUBAGENT_TOOL_IDS.has(toolId)) inferredProfiles.add("subagents");
    if (SCHEDULED_JOB_TOOL_IDS.has(toolId)) inferredProfiles.add("scheduledJobs");
    if (SKILL_MANAGEMENT_TOOL_IDS.has(toolId)) inferredProfiles.add("skillsManagement");
  }

  for (const integrationId of requiredIntegrationIds) {
    const profile = INTEGRATION_PROFILE_BY_ID[integrationId];
    if (profile) inferredProfiles.add(profile);
  }

  for (const token of extractExplicitMetadataTokens(input.instructionsRaw ?? "")) {
    if (DOC_TOOL_IDS.has(token)) inferredProfiles.add("docs");
    if (ANALYTICS_TOOL_IDS.has(token)) inferredProfiles.add("analytics");
    if (WORKSPACE_TOOL_IDS.has(token)) inferredProfiles.add("workspace");
    if (SUBAGENT_TOOL_IDS.has(token)) inferredProfiles.add("subagents");
    if (SCHEDULED_JOB_TOOL_IDS.has(token)) inferredProfiles.add("scheduledJobs");
    if (SKILL_MANAGEMENT_TOOL_IDS.has(token)) inferredProfiles.add("skillsManagement");
    const profile = INTEGRATION_PROFILE_BY_ID[token];
    if (profile) inferredProfiles.add(profile);
  }

  let runtimeMode = input.runtimeMode;
  if (inferredProfiles.has("analytics") || inferredProfiles.has("workspace")) {
    requiredCapabilities.add("sandboxRuntime");
    runtimeMode = "sandboxAugmented";
  } else if (runtimeMode === "sandboxAugmented" && inferredProfiles.size === 0) {
    inferredProfiles.add("workspace");
    requiredCapabilities.add("sandboxRuntime");
  }

  if (requiredCapabilities.has("sandboxRuntime") && !input.allowSandboxRuntime) {
    throw new Error(
      "This skill requires sandboxRuntime, but the user does not have workspace runtime access.",
    );
  }

  ensureIntegrationProfileRequirements(inferredProfiles, requiredIntegrationIds);

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

function ensureIntegrationProfileRequirements(
  inferredProfiles: Set<SkillToolProfileId>,
  requiredIntegrationIds: string[],
): void {
  if (inferredProfiles.has("google") && !requiredIntegrationIds.some((id) => INTEGRATION_PROFILE_BY_ID[id] === "google")) {
    throw new Error("Google profile requires at least one of gmail, drive, or calendar.");
  }
  if (inferredProfiles.has("microsoft") && !requiredIntegrationIds.some((id) => INTEGRATION_PROFILE_BY_ID[id] === "microsoft")) {
    throw new Error("Microsoft profile requires at least one of outlook, onedrive, or ms_calendar.");
  }
  if (inferredProfiles.has("notion") && !requiredIntegrationIds.includes("notion")) {
    throw new Error("Notion profile requires the notion integration.");
  }
  if (inferredProfiles.has("appleCalendar") && !requiredIntegrationIds.includes("apple_calendar")) {
    throw new Error("Apple Calendar profile requires the apple_calendar integration.");
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
