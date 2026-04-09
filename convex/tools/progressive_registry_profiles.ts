"use node";

import { ConvexError } from "convex/values";
import type { SkillToolProfileId } from "../skills/tool_profiles";
import { ToolRegistry, type RegisteredTool } from "./registry";
import { fetchImage } from "./fetch_image";
import { searchChats } from "./search_chats";
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
import { spawnSubagents } from "./spawn_subagents";
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
import {
  registerAnalyticsTools,
  registerWorkspaceProfileTools,
  registerWorkspaceTools,
} from "./workspace_registry";
import type { ProgressiveToolRegistryOptions } from "./progressive_registry";

const DOC_TOOLS: RegisteredTool[] = [
  generateDocx, readDocx, editDocx,
  generatePptx, readPptx, editPptx,
  generateXlsx, readXlsx, editXlsx,
  generateTextFile, readTextFile,
  generateEml, readEml,
];

const DIRECT_TOOL_REGISTRY = new Map<string, RegisteredTool>(
  DOC_TOOLS.map((tool) => [tool.name, tool]),
);

const BASE_TOOLS: RegisteredTool[] = [
  fetchImage,
  searchChats,
  createScheduledJob,
  listScheduledJobs,
  deleteScheduledJob,
  createPersona,
  deletePersona,
  loadSkill,
  listSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  enableSkillForChat,
  disableSkillForChat,
  assignSkillToPersona,
  removeSkillFromPersona,
];

export function registerBaseTools(
  registry: ToolRegistry,
  _allowSubagents: boolean,
  directToolNames: string[] = [],
): void {
  registerToolsIfMissing(registry, BASE_TOOLS);
  registerDirectToolsIfMissing(registry, directToolNames);
}

export function registerProfileTools(
  registry: ToolRegistry,
  profile: SkillToolProfileId,
  options: ProgressiveToolRegistryOptions,
): void {
  switch (profile) {
    case "docs":
      registerToolsIfMissing(registry, DOC_TOOLS);
      break;
    case "analytics":
      registerWorkspaceSubset(registry, registerAnalyticsTools);
      break;
    case "workspace":
      registerWorkspaceSubset(registry, registerWorkspaceProfileTools);
      break;
    case "subagents":
      if (options.allowSubagents) {
        registerToolsIfMissing(registry, [spawnSubagents]);
      }
      break;
    case "google":
      if ((options.enabledIntegrations ?? []).includes("gmail")) {
        registerToolsIfMissing(registry, [
          gmailSend, gmailRead, gmailSearch, gmailDelete, gmailModifyLabels, gmailListLabels,
        ]);
      }
      if ((options.enabledIntegrations ?? []).includes("drive")) {
        registerToolsIfMissing(registry, [driveUpload, driveList, driveRead, driveMove]);
      }
      if ((options.enabledIntegrations ?? []).includes("calendar")) {
        registerToolsIfMissing(registry, [calendarList, calendarCreate, calendarDelete]);
      }
      break;
    case "microsoft":
      if ((options.enabledIntegrations ?? []).includes("outlook")) {
        registerToolsIfMissing(registry, [
          outlookSend, outlookRead, outlookSearch, outlookDelete, outlookMove, outlookListFolders,
        ]);
      }
      if ((options.enabledIntegrations ?? []).includes("onedrive")) {
        registerToolsIfMissing(registry, [onedriveUpload, onedriveList, onedriveRead, onedriveMove]);
      }
      if ((options.enabledIntegrations ?? []).includes("ms_calendar")) {
        registerToolsIfMissing(registry, [msCalendarList, msCalendarCreate, msCalendarDelete]);
      }
      break;
    case "notion":
      if ((options.enabledIntegrations ?? []).includes("notion")) {
        registerToolsIfMissing(registry, [
          notionSearch,
          notionReadPage,
          notionCreatePage,
          notionUpdatePage,
          notionDeletePage,
          notionUpdateDatabaseEntry,
          notionQueryDatabase,
        ]);
      }
      break;
    case "appleCalendar":
      if ((options.enabledIntegrations ?? []).includes("apple_calendar")) {
        registerToolsIfMissing(registry, [
          appleCalendarList,
          appleCalendarCreate,
          appleCalendarUpdate,
          appleCalendarDelete,
        ]);
      }
      break;
    case "scheduledJobs":
    case "skillsManagement":
      break;
  }
}

function registerToolsIfMissing(
  registry: ToolRegistry,
  tools: RegisteredTool[],
): void {
  for (const tool of tools) {
    if (!registry.get(tool.name)) {
      registry.register(tool);
    }
  }
}

function registerDirectToolsIfMissing(
  registry: ToolRegistry,
  toolNames: string[],
): void {
  for (const toolName of toolNames) {
    const tool = DIRECT_TOOL_REGISTRY.get(toolName);
    if (!tool || registry.get(tool.name)) {
      continue;
    }
    registry.register(tool);
  }
}

function registerWorkspaceSubset(
  registry: ToolRegistry,
  registerSubset: (registry: ToolRegistry) => void,
): void {
  const temp = new ToolRegistry();
  const scratch = new ToolRegistry();
  registerSubset(temp);
  registerWorkspaceTools(scratch);

  registerToolsIfMissing(
    registry,
    temp.getDefinitions().map((definition) => {
      const tool = scratch.get(definition.function.name);
      if (!tool) {
        throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: `Workspace tool "${definition.function.name}" was not found in the full registry.` });
      }
      return tool;
    }),
  );
}
