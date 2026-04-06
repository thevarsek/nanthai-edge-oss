// convex/tools/index.ts
// =============================================================================
// Shared tool registry builder.
//
// Centralises tool registration so all entry points (normal chat, paper
// pipeline, regeneration) produce an identical set of always-on tools.
// OAuth-gated tools (Gmail, Drive, Calendar; Outlook, OneDrive, MS Calendar;
// Notion) are registered conditionally when the user has an active connection.
// =============================================================================

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { ToolRegistry } from "./registry";
import { deriveGoogleCapabilityFlags } from "../oauth/google_capabilities";
import { generateDocx } from "./generate_docx";
import { readDocx } from "./read_docx";
import { editDocx } from "./edit_docx";
import { generatePptx } from "./generate_pptx";
import { readPptx } from "./read_pptx";
import { editPptx } from "./edit_pptx";
import { generateXlsx } from "./generate_xlsx";
import { readXlsx } from "./read_xlsx";
import { editXlsx } from "./edit_xlsx";
import { generateTextFile } from "./generate_text_file";
import { readTextFile } from "./read_text_file";
import { generateEml } from "./generate_eml";
import { readEml } from "./read_eml";
import { fetchImage } from "./fetch_image";
import { createScheduledJob, listScheduledJobs, deleteScheduledJob } from "./scheduled_jobs";
import { createPersona, deletePersona } from "./persona";
import { loadSkill } from "./load_skill";
import {
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  enableSkillForChat,
  disableSkillForChat,
  assignSkillToPersona,
  removeSkillFromPersona,
} from "./skill_management";
import { searchChats } from "./search_chats";
import { spawnSubagents } from "./spawn_subagents";
import {
  gmailSend,
  gmailRead,
  gmailSearch,
  gmailDelete,
  gmailModifyLabels,
  gmailListLabels,
  driveUpload,
  driveList,
  driveRead,
  driveMove,
  calendarList,
  calendarCreate,
  calendarDelete,
} from "./google/index";
import {
  outlookSend,
  outlookRead,
  outlookSearch,
  outlookDelete,
  outlookMove,
  outlookListFolders,
  onedriveUpload,
  onedriveList,
  onedriveRead,
  onedriveMove,
  msCalendarList,
  msCalendarCreate,
  msCalendarDelete,
} from "./microsoft/index";
import {
  notionSearch,
  notionReadPage,
  notionCreatePage,
  notionUpdatePage,
  notionDeletePage,
  notionUpdateDatabaseEntry,
  notionQueryDatabase,
} from "./notion/index";
import {
  appleCalendarList,
  appleCalendarCreate,
  appleCalendarUpdate,
  appleCalendarDelete,
} from "./apple/index";

/** Options for conditional tool registration. */
export interface BuildToolRegistryOptions {
  /**
   * Which external integrations the user has enabled for this chat.
   * Possible values: "gmail", "drive", "calendar", "outlook", "onedrive", "ms_calendar", "apple_calendar", "notion".
   * Only tools whose integration group is listed here AND whose OAuth
   * connection is active will be registered.
   */
  enabledIntegrations?: string[];

  /**
   * Whether the user has Pro status. Pro-only tools (scheduled jobs, personas)
   * are only registered when this is true. Defaults to false.
   */
  isPro?: boolean;

  /** Whether the parent chat run may delegate to subagents. */
  allowSubagents?: boolean;

  /**
   * Whether the caller intends to append internal Max runtime workspace tools.
   * Workspace tools are registered separately from node-only entrypoints.
   */
  allowWorkspaceRuntime?: boolean;
}

/**
 * Build a tool registry containing all always-on tools plus any
 * conditionally enabled OAuth-gated tools.
 *
 * Tier 1 (document generation/read/edit) tools are always registered.
 * Tier 2 (Google Workspace) tools are registered when the user has an
 * active Google connection.
 * Tier 2 (Microsoft 365) tools are registered when the user has an
 * active Microsoft connection.
 * Tier 2 (Notion) tools are registered when the user has an active
 * Notion connection.
 */
export function buildToolRegistry(
  options?: BuildToolRegistryOptions,
): ToolRegistry {
  const registry = new ToolRegistry();

  // M14: All AI tools are Pro-only. Free users get an empty registry.
  // The search pipeline (paper phases) calls buildToolRegistry() without isPro
  // and relies on the returned tools for document generation — those callers
  // run server-side as internal actions, not as user-facing chat, so they
  // pass no options and hit the early return check below only when isPro is
  // explicitly false. When options is undefined (server pipeline), we allow
  // all tools since there's no user entitlement context.
  if (options !== undefined && !options.isPro) {
    return registry; // empty — free users cannot trigger tool calls
  }

  // Tier 1 — OOXML document tools
  registry.register(
    generateDocx, readDocx, editDocx,
    generatePptx, readPptx, editPptx,
    generateXlsx, readXlsx, editXlsx,
  );

  // Tier 1 — Text-based file tools
  registry.register(
    generateTextFile, readTextFile,
    generateEml, readEml,
  );

  // Tier 1 — Utility tools
  registry.register(fetchImage);

  // Tier 1 — Chat search tool
  registry.register(searchChats);

  // Tier 1 — Scheduled job management tools
  registry.register(createScheduledJob, listScheduledJobs, deleteScheduledJob);

  // Tier 1 — Persona management tools
  registry.register(createPersona, deletePersona);

  // Tier 1 — Skill tools (load_skill + management)
  registry.register(
    loadSkill,
    listSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    enableSkillForChat,
    disableSkillForChat,
    assignSkillToPersona,
    removeSkillFromPersona,
  );

  if (options?.allowSubagents) {
    registry.register(spawnSubagents);
  }

  // Tier 2 — Google Workspace tools (registered per-integration group)
  const enabled = options?.enabledIntegrations ?? [];
  if (enabled.includes("gmail")) {
    registry.register(gmailSend, gmailRead, gmailSearch, gmailDelete, gmailModifyLabels, gmailListLabels);
  }
  if (enabled.includes("drive")) {
    registry.register(driveUpload, driveList, driveRead, driveMove);
  }
  if (enabled.includes("calendar")) {
    registry.register(calendarList, calendarCreate, calendarDelete);
  }

  // Tier 2 — Microsoft 365 tools (registered per-integration group)
  if (enabled.includes("outlook")) {
    registry.register(outlookSend, outlookRead, outlookSearch, outlookDelete, outlookMove, outlookListFolders);
  }
  if (enabled.includes("onedrive")) {
    registry.register(onedriveUpload, onedriveList, onedriveRead, onedriveMove);
  }
  if (enabled.includes("ms_calendar")) {
    registry.register(msCalendarList, msCalendarCreate, msCalendarDelete);
  }

  // Tier 2 — Apple Calendar tools
  if (enabled.includes("apple_calendar")) {
    registry.register(
      appleCalendarList,
      appleCalendarCreate,
      appleCalendarUpdate,
      appleCalendarDelete,
    );
  }

  // Tier 2 — Notion tools (single integration group)
  if (enabled.includes("notion")) {
    registry.register(
      notionSearch, notionReadPage, notionCreatePage,
      notionUpdatePage, notionDeletePage, notionUpdateDatabaseEntry,
      notionQueryDatabase,
    );
  }

  return registry;
}

/**
 * Get Google integrations that are both connected and scope-granted.
 */
export async function getGrantedGoogleIntegrations(
  ctx: ActionCtx,
  userId: string,
): Promise<string[]> {
  try {
    const connection = await ctx.runQuery(
      internal.oauth.google.getConnectionInternal,
      { userId },
    );
    if (connection === null || connection.status !== "active") {
      return [];
    }
    const flags = deriveGoogleCapabilityFlags(connection.scopes);
    const integrations: string[] = [];
    if (flags.hasGmail) integrations.push("gmail");
    if (flags.hasDrive) integrations.push("drive");
    if (flags.hasCalendar) integrations.push("calendar");
    return integrations;
  } catch {
    return [];
  }
}

/**
 * Check whether a user has an active Microsoft OAuth connection.
 * Lightweight query suitable for calling before `buildToolRegistry()`.
 */
export async function checkMicrosoftConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await ctx.runQuery(
      internal.oauth.microsoft.getConnectionInternal,
      { userId },
    );
    return connection !== null && connection.status === "active";
  } catch {
    // If the query fails (e.g. table doesn't exist yet), treat as no connection
    return false;
  }
}

/**
 * Check whether a user has an active Notion OAuth connection.
 * Lightweight query suitable for calling before `buildToolRegistry()`.
 */
export async function checkNotionConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await ctx.runQuery(
      internal.oauth.notion.getConnectionInternal,
      { userId },
    );
    return connection !== null && connection.status === "active";
  } catch {
    // If the query fails (e.g. table doesn't exist yet), treat as no connection
    return false;
  }
}

/**
 * Check whether a user has an active Apple Calendar connection.
 * Lightweight query suitable for calling before `buildToolRegistry()`.
 */
export async function checkAppleCalendarConnection(
  ctx: ActionCtx,
  userId: string,
): Promise<boolean> {
  try {
    const connection = await ctx.runQuery(
      internal.oauth.apple_calendar.getConnectionInternal,
      { userId },
    );
    return connection !== null && connection.status === "active";
  } catch {
    return false;
  }
}
