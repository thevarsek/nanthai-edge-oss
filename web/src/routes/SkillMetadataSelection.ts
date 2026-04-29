import type { Id } from "@convex/_generated/dataModel";

export const SKILL_INTEGRATION_OPTIONS = [
  { id: "gmail", label: "Gmail" },
  { id: "drive", label: "Google Drive" },
  { id: "calendar", label: "Google Calendar" },
  { id: "outlook", label: "Outlook" },
  { id: "onedrive", label: "OneDrive" },
  { id: "ms_calendar", label: "Microsoft Calendar" },
  { id: "apple_calendar", label: "Apple Calendar" },
  { id: "notion", label: "Notion" },
  { id: "cloze", label: "Cloze CRM" },
  { id: "slack", label: "Slack" },
] as const;

export type SkillIntegrationId = (typeof SKILL_INTEGRATION_OPTIONS)[number]["id"];
export type SkillToolProfileId =
  | "docs"
  | "analytics"
  | "workspace"
  | "subagents"
  | "google"
  | "microsoft"
  | "notion"
  | "cloze"
  | "slack"
  | "appleCalendar"
  | "scheduledJobs"
  | "skillsManagement";
export type SkillCapabilityId = never;

interface SkillLike {
  _id?: Id<"skills">;
  requiredToolProfiles?: string[];
  requiredIntegrationIds?: string[];
  requiredCapabilities?: string[];
}

export interface SkillMetadataSelection {
  usesCodingWorkspace: boolean;
  usesDataAnalysis: boolean;
  usesDocuments: boolean;
  selectedIntegrationIds: Set<string>;
}

export function emptySkillMetadataSelection(): SkillMetadataSelection {
  return {
    usesCodingWorkspace: false,
    usesDataAnalysis: false,
    usesDocuments: false,
    selectedIntegrationIds: new Set<string>(),
  };
}

export function cloneSkillMetadataSelection(selection: SkillMetadataSelection): SkillMetadataSelection {
  return {
    usesCodingWorkspace: selection.usesCodingWorkspace,
    usesDataAnalysis: selection.usesDataAnalysis,
    usesDocuments: selection.usesDocuments,
    selectedIntegrationIds: new Set(selection.selectedIntegrationIds),
  };
}

export function skillSelectionEquals(a: SkillMetadataSelection, b: SkillMetadataSelection): boolean {
  if (
    a.usesCodingWorkspace !== b.usesCodingWorkspace ||
    a.usesDataAnalysis !== b.usesDataAnalysis ||
    a.usesDocuments !== b.usesDocuments ||
    a.selectedIntegrationIds.size !== b.selectedIntegrationIds.size
  ) {
    return false;
  }

  for (const id of a.selectedIntegrationIds) {
    if (!b.selectedIntegrationIds.has(id)) return false;
  }
  return true;
}

export function requiredToolProfilesForSkill(selection: SkillMetadataSelection): SkillToolProfileId[] {
  const profiles = new Set<SkillToolProfileId>();
  if (selection.usesDocuments) profiles.add("docs");
  if (selection.usesDataAnalysis) {
    profiles.add("analytics");
  } else if (selection.usesCodingWorkspace) {
    profiles.add("workspace");
  }
  if (Array.from(selection.selectedIntegrationIds).some((id) => ["gmail", "drive", "calendar"].includes(id))) {
    profiles.add("google");
  }
  if (Array.from(selection.selectedIntegrationIds).some((id) => ["outlook", "onedrive", "ms_calendar"].includes(id))) {
    profiles.add("microsoft");
  }
  if (selection.selectedIntegrationIds.has("notion")) profiles.add("notion");
  if (selection.selectedIntegrationIds.has("cloze")) profiles.add("cloze");
  if (selection.selectedIntegrationIds.has("slack")) profiles.add("slack");
  if (selection.selectedIntegrationIds.has("apple_calendar")) profiles.add("appleCalendar");
  return Array.from(profiles).sort();
}

export function requiredCapabilitiesForSkill(selection?: SkillMetadataSelection): SkillCapabilityId[] {
  void selection;
  return [];
}

export function inferredRuntimeMode(selection: SkillMetadataSelection): "textOnly" | "toolAugmented" | "sandboxAugmented" {
  if (selection.usesCodingWorkspace || selection.usesDataAnalysis) return "sandboxAugmented";
  if (selection.usesDocuments || selection.selectedIntegrationIds.size > 0) return "toolAugmented";
  return "textOnly";
}

export function skillMetadataSelectionFromSkill(skill: SkillLike): SkillMetadataSelection {
  const profiles = skill.requiredToolProfiles ?? [];
  return {
    usesCodingWorkspace: profiles.includes("workspace"),
    usesDataAnalysis: profiles.includes("analytics"),
    usesDocuments: profiles.includes("docs"),
    selectedIntegrationIds: new Set(skill.requiredIntegrationIds ?? []),
  };
}

export function inferSkillMetadataSelection(summary: string, instructionsRaw: string): SkillMetadataSelection {
  const text = `${summary}\n${instructionsRaw}`.toLowerCase();
  const next = emptySkillMetadataSelection();

  next.usesDocuments = [
    "docx",
    "pptx",
    "xlsx",
    "spreadsheet",
    "presentation",
    "word document",
  ].some((needle) => text.includes(needle));

  next.usesDataAnalysis = [
    "data_python_exec",
    "workspace_import_file",
    "matplotlib",
    "pandas",
    "dataframe",
    "csv",
    "tsv",
    "xlsx",
  ].some((needle) => text.includes(needle));

  const usesWorkspace = [
    "workspace_exec",
    "workspace_write_file",
    "workspace_read_file",
    "workspace_make_dirs",
    "workspace_reset",
    "terminal",
    "shell",
    "bash",
  ].some((needle) => text.includes(needle));

  next.usesCodingWorkspace = usesWorkspace && !next.usesDataAnalysis;

  for (const option of SKILL_INTEGRATION_OPTIONS) {
    if (text.includes(option.id.replace(/_/g, " ")) || text.includes(option.label.toLowerCase())) {
      next.selectedIntegrationIds.add(option.id);
    }
  }

  return next;
}
