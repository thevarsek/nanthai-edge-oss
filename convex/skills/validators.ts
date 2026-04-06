// convex/skills/validators.ts
// =============================================================================
// Deterministic validation for skill instructions.
//
// Scans raw instruction text for banned runtime patterns (bash, filesystem,
// browser, MCP, raw fetch, bundled scripts) and returns structured warnings
// and incompatibility codes. Used at save time before LLM compilation.
// =============================================================================

/** A single validation finding. */
export interface ValidationFinding {
  /** Machine-readable code (e.g. "USES_BASH"). */
  code: string;
  /** Human-readable description of the issue. */
  message: string;
  /** Whether this is a hard block ("error") or soft warning ("warning"). */
  severity: "error" | "warning";
}

/** Result of scanning skill instructions. */
export interface ValidationResult {
  /** True if no hard errors were found. */
  isCompatible: boolean;
  /** All findings (errors + warnings). */
  findings: ValidationFinding[];
  /** Just the error-level codes. */
  unsupportedCapabilityCodes: string[];
  /** Just the warning-level messages. */
  validationWarnings: string[];
}

export interface SkillValidationOptions {
  allowSandboxRuntime?: boolean;
}

// ---------------------------------------------------------------------------
// Banned pattern definitions
// ---------------------------------------------------------------------------

interface BannedPattern {
  code: string;
  message: string;
  /** Case-insensitive regex patterns to test against the raw instructions. */
  patterns: RegExp[];
}

const BANNED_PATTERNS: BannedPattern[] = [
  {
    code: "USES_BASH",
    message: "Skill references shell/bash/terminal commands which are not available in NanthAI.",
    patterns: [
      /\bbash\b/i,
      /\bshell\b/i,
      /\bterminal\b/i,
      /\bcommand[- ]?line\b/i,
      /\bcli\b/i,
      /\b(?:run|execute)\s+(?:the\s+)?(?:command|script)\b/i,
      /\bnpx\b/i,
      /\bnpm\s+(?:run|install|exec)\b/i,
      /\bpip\s+install\b/i,
      /\bcargo\s+(?:run|build)\b/i,
      /\$\(.+\)/,
      /`[^`]*(?:mkdir|rm|cp|mv|chmod|chown|curl|wget|apt|brew)\b[^`]*`/i,
    ],
  },
  {
    code: "USES_FILESYSTEM",
    message: "Skill references local filesystem read/write which is not available in NanthAI.",
    patterns: [
      /\blocal\s+file\s*system\b/i,
      /\bread\s+(?:the\s+)?file\b/i,
      /\bwrite\s+(?:to\s+)?(?:the\s+)?file\b/i,
      /\bfs\.\w+/i,
      /\bopen\(.+['"]\s*[rwa]\s*['"]\)/i,
      /\bSKILL\.md\b/,
      /\breferences\/\w+\.md\b/,
      /\bscripts\/\w+\.py\b/,
      /\bassets\/\w+/,
    ],
  },
  {
    code: "USES_BROWSER",
    message: "Skill references browser automation or desktop control which is not available in NanthAI.",
    patterns: [
      /\bplaywright\b/i,
      /\bpuppeteer\b/i,
      /\bselenium\b/i,
      /\bscreenshot\b/i,
      /\bwebdriver\b/i,
      /\bbrowser\s+automation\b/i,
      /\bdesktop\s+control\b/i,
    ],
  },
  {
    code: "USES_MCP",
    message: "Skill references MCP servers or external process management which is not available in NanthAI.",
    patterns: [
      /\bMCP\s+server\b/i,
      /\bmodel\s+context\s+protocol\b/i,
      /\bspawn\s+(?:a\s+)?process\b/i,
      /\bchild_process\b/i,
      /\bsubprocess\b/i,
    ],
  },
  {
    code: "USES_RAW_FETCH",
    message: "Skill references raw HTTP fetches outside named NanthAI tools.",
    patterns: [
      /\bfetch\(\s*['"]https?:\/\//i,
      /\baxios\b/i,
      /\brequests\.get\b/i,
      /\bcurl\s+/i,
      /\bwget\s+/i,
    ],
  },
  {
    code: "USES_BUNDLED_SCRIPTS",
    message: "Skill references bundled scripts or assets that cannot be loaded in NanthAI's runtime.",
    patterns: [
      /\binit_skill\.py\b/,
      /\bpackage_skill\.py\b/,
      /\bquick_validate\.py\b/,
      /\brun\s+(?:the\s+)?script\b/i,
      /\bexecute\s+(?:the\s+)?(?:python|node|ruby)\b/i,
    ],
  },
  {
    code: "USES_GIT",
    message: "Skill references git operations which are not available in NanthAI.",
    patterns: [
      /\bgit\s+(?:clone|pull|push|commit|checkout|branch|merge|rebase|stash)\b/i,
      /\bgit\s+(?:add|status|log|diff)\b/i,
    ],
  },
];

// ---------------------------------------------------------------------------
// Known NanthAI tool IDs (for validating requiredToolIds)
// ---------------------------------------------------------------------------

const KNOWN_TOOL_IDS = new Set([
  "generate_docx", "read_docx", "edit_docx",
  "generate_pptx", "read_pptx", "edit_pptx",
  "generate_xlsx", "read_xlsx", "edit_xlsx",
  "generate_text_file", "read_text_file",
  "generate_eml", "read_eml",
  "fetch_image",
  "search_chats",
  "create_scheduled_job", "list_scheduled_jobs", "delete_scheduled_job",
  "create_persona", "delete_persona",
  "spawn_subagents",
  "workspace_exec", "workspace_list_files", "workspace_read_file",
  "workspace_write_file", "workspace_make_dirs", "workspace_import_file",
  "workspace_export_file", "data_python_exec", "workspace_reset",
  // Google
  "gmail_send", "gmail_read", "gmail_search", "gmail_delete",
  "gmail_modify_labels", "gmail_list_labels",
  "drive_upload", "drive_list", "drive_read", "drive_move",
  "google_calendar_list", "google_calendar_create", "google_calendar_delete",
  "calendar_list", "calendar_create", "calendar_delete",
  // Microsoft
  "outlook_send", "outlook_read", "outlook_search", "outlook_delete",
  "outlook_move", "outlook_list_folders",
  "onedrive_upload", "onedrive_list", "onedrive_read", "onedrive_move",
  "ms_calendar_list", "ms_calendar_create", "ms_calendar_delete",
  // Apple
  "apple_calendar_list", "apple_calendar_create",
  "apple_calendar_update", "apple_calendar_delete",
  // Notion
  "notion_search", "notion_read_page", "notion_create_page",
  "notion_update_page", "notion_delete_page",
  "notion_update_database_entry", "notion_query_database",
  // Skills (self-referential)
  "load_skill", "list_skills", "create_skill", "update_skill",
  "delete_skill", "enable_skill_for_chat", "disable_skill_for_chat",
  "assign_skill_to_persona", "remove_skill_from_persona",
]);

/** Known NanthAI integration group IDs. */
const KNOWN_INTEGRATION_IDS = new Set([
  "gmail", "drive", "calendar",
  "outlook", "onedrive", "ms_calendar",
  "apple_calendar",
  "notion",
]);

const KNOWN_CAPABILITY_IDS = new Set([
  "pro",
  "sandboxRuntime",
  "mcpRuntime",
]);

const SANDBOX_COMPATIBLE_CODES = new Set([
  "USES_BASH",
  "USES_FILESYSTEM",
  "USES_RAW_FETCH",
  "USES_BUNDLED_SCRIPTS",
  "USES_GIT",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan raw skill instructions for banned runtime patterns.
 * Returns structured validation results with codes and messages.
 */
export function validateSkillInstructions(
  rawInstructions: string,
  options: SkillValidationOptions = {},
): ValidationResult {
  const findings: ValidationFinding[] = [];

  // Check for banned patterns
  for (const banned of BANNED_PATTERNS) {
    const matched = banned.patterns.some((p) => p.test(rawInstructions));
    if (matched) {
      const isSandboxCompatible =
        options.allowSandboxRuntime === true &&
        SANDBOX_COMPATIBLE_CODES.has(banned.code);
      findings.push({
        code: banned.code,
        message: banned.message,
        severity: isSandboxCompatible ? "warning" : "error",
      });
    }
  }

  // Warn if instructions are very short
  if (rawInstructions.trim().length < 50) {
    findings.push({
      code: "TOO_SHORT",
      message: "Skill instructions are very short. Consider adding more detail for best results.",
      severity: "warning",
    });
  }

  // Warn if instructions are very long (>10k chars)
  if (rawInstructions.length > 10_000) {
    findings.push({
      code: "VERY_LONG",
      message:
        "Skill instructions exceed 10,000 characters. Consider condensing for better context efficiency.",
      severity: "warning",
    });
  }

  const unsupportedCapabilityCodes = findings
    .filter((f) => f.severity === "error")
    .map((f) => f.code);

  const validationWarnings = findings
    .filter((f) => f.severity === "warning")
    .map((f) => f.message);

  return {
    isCompatible: unsupportedCapabilityCodes.length === 0,
    findings,
    unsupportedCapabilityCodes,
    validationWarnings,
  };
}

/**
 * Validate that an array of tool IDs are all known NanthAI tools.
 * Returns unknown IDs (if any).
 */
export function validateToolIds(toolIds: string[]): string[] {
  return toolIds.filter((id) => !KNOWN_TOOL_IDS.has(id));
}

/**
 * Validate that an array of integration IDs are all known NanthAI integrations.
 * Returns unknown IDs (if any).
 */
export function validateIntegrationIds(integrationIds: string[]): string[] {
  return integrationIds.filter((id) => !KNOWN_INTEGRATION_IDS.has(id));
}

/**
 * Validate that an array of capability IDs are all known NanthAI capabilities.
 * Returns unknown IDs (if any).
 */
export function validateCapabilityIds(capabilityIds: string[]): string[] {
  return capabilityIds.filter((id) => !KNOWN_CAPABILITY_IDS.has(id));
}

/**
 * Generate a URL-safe slug from a skill name.
 * Lowercase, hyphenated, no special characters.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
