import type { ToolCall, ToolResult } from "@/hooks/useChat";

const TOOL_DISPLAY: Record<string, string> = {
  web_search: "Web Search",
  web_browse: "Browse URL",
  load_skill: "Load Skill",
  list_skills: "List Skills",
  create_skill: "Create Skill",
  update_skill: "Update Skill",
  delete_skill: "Delete Skill",
  enable_skill_for_chat: "Enable Skill",
  disable_skill_for_chat: "Disable Skill",
  assign_skill_to_persona: "Assign Skill to Persona",
  remove_skill_from_persona: "Remove Skill from Persona",
  workspace_exec: "Run Code",
  workspace_list_files: "List Files",
  workspace_read_file: "Read File",
  workspace_write_file: "Write File",
  workspace_make_dirs: "Create Directories",
  workspace_export_file: "Export File",
  workspace_reset: "Reset Workspace",
  workspace_import_file: "Import File",
  data_python_exec: "Python Execution",
  data_python_sandbox: "Python Sandbox",
  generate_chart: "Generate Chart",
  generate_docx: "Generate Document",
  generate_xlsx: "Generate Spreadsheet",
  generate_pptx: "Generate Presentation",
  create_presentation: "Create Presentation",
  edit_presentation: "Edit Presentation",
  read_presentation: "Read Presentation",
  read_pptx: "Read PowerPoint",
  search_google: "Google Search",
  search_gmail: "Search Gmail",
  read_email: "Read Email",
  send_email: "Send Email",
  list_events: "List Calendar Events",
  create_event: "Create Calendar Event",
  search_drive: "Search Drive",
  read_drive_file: "Read Drive File",
  search_notion: "Search Notion",
  read_notion_page: "Read Notion Page",
};

const TOOL_TRANSLATION_KEYS: Record<string, string> = {
  web_search: "web_search",
  load_skill: "load_skill",
  generate_pptx: "generate_presentation",
  create_presentation: "create_presentation",
  edit_presentation: "edit_presentation",
  read_presentation: "read_presentation",
  read_pptx: "read_presentation",
};

const SKILL_TOOLS = new Set([
  "load_skill",
  "list_skills",
  "create_skill",
  "update_skill",
  "delete_skill",
  "enable_skill_for_chat",
  "disable_skill_for_chat",
  "assign_skill_to_persona",
  "remove_skill_from_persona",
]);

const SAFE_ID_KEYS = new Set([
  "elementid",
  "elementids",
  "slideid",
  "slideids",
  "skillid",
  "skillids",
  "integrationid",
  "integrationids",
  "modelid",
  "modelids",
]);
const INTERNAL_FILE_URL = /https?:\/\/[^\s"']*convex\.(?:cloud|site)\/(?:api\/storage|download)[^\s"']*/gi;
const MAX_DISPLAY_LENGTH = 8_000;

export function getToolName(name: string, translate?: (key: string) => string): string {
  const translationKey = TOOL_TRANSLATION_KEYS[name];
  if (translationKey && translate) return translate(translationKey);
  return TOOL_DISPLAY[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (/token|secret|password|apikey|authorization/.test(normalized)) return true;
  return (normalized.endsWith("id") || normalized.endsWith("ids")) &&
    !SAFE_ID_KEYS.has(normalized);
}

function sanitizeString(value: string): string {
  return value.replace(INTERNAL_FILE_URL, "[internal file URL]");
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 12) return "[nested data omitted]";
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    shouldRedactKey(key) ? "[internal]" : sanitizeValue(child, depth + 1),
  ]));
}

export function formatToolPayloadForDisplay(payload: string): string {
  let formatted: string;
  try {
    formatted = JSON.stringify(sanitizeValue(JSON.parse(payload)), null, 2);
  } catch {
    formatted = sanitizeString(payload);
  }
  if (formatted.length <= MAX_DISPLAY_LENGTH) return formatted;
  return `${formatted.slice(0, MAX_DISPLAY_LENGTH)}\n… technical output truncated`;
}

export function skillSummary(
  toolCall: ToolCall,
  result?: ToolResult,
): { title: string; subtitle: string } | null {
  if (!SKILL_TOOLS.has(toolCall.name)) return null;
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(toolCall.arguments) as Record<string, unknown>; } catch { /* invalid args */ }

  const skillName = typeof args.skillName === "string"
    ? args.skillName
    : typeof args.name === "string"
      ? args.name
      : typeof args.skillId === "string"
        ? args.skillId
        : "Skill";

  switch (toolCall.name) {
    case "load_skill":
      return { title: `Load ${skillName}`, subtitle: result ? "Skill loaded into the current run." : "Loading skill into the current run." };
    case "list_skills":
      return { title: "List skills", subtitle: result ? "Fetched available skills." : "Fetching visible skills." };
    case "create_skill":
      return { title: `Create ${skillName}`, subtitle: result ? "Created a new user skill." : "Creating a new user skill." };
    case "update_skill":
      return { title: `Update ${skillName}`, subtitle: result ? "Updated skill instructions or metadata." : "Updating skill." };
    case "delete_skill":
      return { title: `Delete ${skillName}`, subtitle: result ? "Deleted the skill." : "Deleting skill." };
    case "enable_skill_for_chat":
      return { title: `Enable ${skillName}`, subtitle: result ? "Enabled for this chat." : "Enabling for this chat." };
    case "disable_skill_for_chat":
      return { title: `Disable ${skillName}`, subtitle: result ? "Disabled for this chat." : "Disabling for this chat." };
    case "assign_skill_to_persona":
      return { title: `Assign ${skillName}`, subtitle: result ? "Assigned to persona." : "Assigning to persona." };
    case "remove_skill_from_persona":
      return { title: `Remove ${skillName}`, subtitle: result ? "Removed from persona." : "Removing from persona." };
    default:
      return null;
  }
}
