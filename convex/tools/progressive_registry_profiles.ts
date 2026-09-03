"use node";

import type { SkillToolProfileId } from "../skills/tool_profiles";
import { ToolRegistry, type RegisteredTool } from "./registry";
import { fetchImage } from "./fetch_image";
import { searchChats } from "./search_chats";
import { webSearch } from "./web_search";
import { createScheduledJob, listScheduledJobs, deleteScheduledJob } from "./scheduled_jobs";
import { updateScheduledJob } from "./scheduled_jobs_update";
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
import { proposeDocxEdits } from "./docx_edit_proxy";
import { readPptx } from "./read_pptx";
import { generatePptx, editPptx } from "./pptx_proxy";
import { createPresentation, editPresentation } from "./presentation_proxy";
import { readPresentation } from "./read_presentation";
import { generateXlsx } from "./generate_xlsx";
import { readXlsx } from "./read_xlsx";
import { editXlsx } from "./edit_xlsx";
import { generateTextFile } from "./generate_text_file";
import { readTextFile } from "./read_text_file";
import {
  findInDocument,
  listDocuments,
  readDocument,
} from "./document_workspace";
import { generateEml } from "./generate_eml";
import { readEml } from "./read_eml";
import { generateImage } from "./generate_image";
import { generateMusic, generateSpeech } from "./generate_audio";
import { generateVideo } from "./generate_video";
import {
  gmailSend,
  gmailCreateDraft,
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
  outlookCreateDraft,
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
} from "./apple/proxy";
import {
  clozePersonFind,
  clozePersonCount,
  clozePersonAdd,
  clozePersonChange,
  clozeAddNote,
  clozeAddTodo,
  clozeTimeline,
  clozeSaveDraft,
  clozeAboutMe,
  clozeProjectFind,
  clozeProjectChange,
} from "./cloze/index";
import {
  slackSearchMessages,
  slackSearchUsers,
  slackSearchChannels,
  slackSendMessage,
  slackReadChannel,
  slackReadThread,
  slackCreateCanvas,
  slackUpdateCanvas,
  slackReadCanvas,
  slackReadUserProfile,
} from "./slack/index";
import {
  analyticsProfileTools,
  persistentRuntimeProfileTools,
  workspaceProfileTools,
} from "./workspace_registry";
import type { ProgressiveToolRegistryOptions } from "./progressive_registry";
const DOC_TOOLS: RegisteredTool[] = [
  listDocuments, readDocument, findInDocument,
  generateDocx, readDocx, editDocx,
  proposeDocxEdits,
  generatePptx, readPptx, editPptx,
  createPresentation, readPresentation, editPresentation,
  generateXlsx, readXlsx, editXlsx,
  generateTextFile, readTextFile,
  generateEml, readEml,
];

const PRESENTATION_TOOLS: RegisteredTool[] = [
  createPresentation, readPresentation, editPresentation, readPptx,
];

const DIRECT_TOOL_REGISTRY = new Map<string, RegisteredTool>(
  DOC_TOOLS.map((tool) => [tool.name, tool]),
);

const BASE_TOOLS: RegisteredTool[] = [fetchImage, searchChats, loadSkill, listSkills];

export function registerBaseTools(
  registry: ToolRegistry,
  allowSubagents: boolean,
  directToolNames: string[] = [],
  webSearchToolEnabled = false,
): void {
  registerToolsIfMissing(registry, BASE_TOOLS);
  if (allowSubagents) {
    registerToolsIfMissing(registry, [spawnSubagents]);
  }
  if (webSearchToolEnabled) {
    registerToolsIfMissing(registry, [webSearch]);
  }
  registerDirectToolsIfMissing(registry, directToolNames);
}

export function registerProfileTools(
  registry: ToolRegistry,
  profile: SkillToolProfileId,
  options: ProgressiveToolRegistryOptions,
): void {
  switch (profile) {
    case "presentations":
      registerToolsIfMissing(registry, PRESENTATION_TOOLS);
      break;
    case "docs":
      registerToolsIfMissing(registry, DOC_TOOLS);
      break;
    case "imageGeneration":
      registerToolsIfMissing(registry, [generateImage]);
      break;
    case "musicGeneration":
      registerToolsIfMissing(registry, [generateMusic]);
      break;
    case "speechGeneration":
      registerToolsIfMissing(registry, [generateSpeech]);
      break;
    case "videoGeneration":
      registerToolsIfMissing(registry, [generateVideo]);
      break;
    case "analytics":
      registerToolsIfMissing(registry, analyticsProfileTools);
      break;
    case "workspace":
      registerToolsIfMissing(registry, workspaceProfileTools);
      break;
    case "persistentRuntime":
      registerToolsIfMissing(registry, persistentRuntimeProfileTools);
      break;
    case "subagents":
      if (options.allowSubagents) {
        registerToolsIfMissing(registry, [spawnSubagents]);
      }
      break;
    case "google":
      if ((options.enabledIntegrations ?? []).includes("gmail")) {
        registerToolsIfMissing(registry, [
          gmailSend, gmailCreateDraft, gmailRead, gmailSearch, gmailDelete, gmailModifyLabels, gmailListLabels,
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
          outlookSend, outlookCreateDraft, outlookRead, outlookSearch, outlookDelete, outlookMove, outlookListFolders,
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
    case "cloze":
      if ((options.enabledIntegrations ?? []).includes("cloze")) {
        registerToolsIfMissing(registry, [
          clozePersonFind,
          clozePersonCount,
          clozePersonAdd,
          clozePersonChange,
          clozeAddNote,
          clozeAddTodo,
          clozeTimeline,
          clozeSaveDraft,
          clozeAboutMe,
          clozeProjectFind,
          clozeProjectChange,
        ]);
      }
      break;
    case "slack":
      if ((options.enabledIntegrations ?? []).includes("slack")) {
        registerToolsIfMissing(registry, [
          slackSearchMessages,
          slackSearchUsers,
          slackSearchChannels,
          slackSendMessage,
          slackReadChannel,
          slackReadThread,
          slackCreateCanvas,
          slackUpdateCanvas,
          slackReadCanvas,
          slackReadUserProfile,
        ]);
      }
      break;
    case "scheduledJobs":
      registerToolsIfMissing(registry, [
        createScheduledJob, listScheduledJobs, updateScheduledJob, deleteScheduledJob,
      ]);
      break;
    case "skillsManagement":
      registerToolsIfMissing(registry, [
        createSkill, updateSkill, deleteSkill,
        enableSkillForChat, disableSkillForChat,
        assignSkillToPersona, removeSkillFromPersona,
      ]);
      break;
    case "personas":
      registerToolsIfMissing(registry, [createPersona, deletePersona]);
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
