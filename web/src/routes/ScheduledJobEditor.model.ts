import { SCHEDULED_JOB_DEFAULT_MODEL_ID } from "../lib/modelDefaults";

export type SearchMode = "none" | "basic" | "web" | "research";
export type RecurrenceType = "manual" | "interval" | "daily" | "weekly" | "cron";

export interface DraftStep {
  id: string;
  title: string;
  prompt: string;
  modelId: string;
  selectedPersonaId: string | null;
  searchMode: SearchMode;
  searchComplexity: number;
  includeReasoning: boolean;
  reasoningEffort: string;
  gmailEnabled: boolean;
  driveEnabled: boolean;
  calendarEnabled: boolean;
  outlookEnabled: boolean;
  onedriveEnabled: boolean;
  msCalendarEnabled: boolean;
  appleCalendarEnabled: boolean;
  notionEnabled: boolean;
  clozeEnabled: boolean;
  slackEnabled: boolean;
  knowledgeBaseFileIds: string[];
}

export const SCHEDULED_JOB_DEFAULT_MODEL = SCHEDULED_JOB_DEFAULT_MODEL_ID;

export function createDraftStep(): DraftStep {
  return {
    id: crypto.randomUUID(),
    title: "",
    prompt: "",
    modelId: SCHEDULED_JOB_DEFAULT_MODEL,
    selectedPersonaId: null,
    searchMode: "none",
    searchComplexity: 1,
    includeReasoning: false,
    reasoningEffort: "medium",
    gmailEnabled: false,
    driveEnabled: false,
    calendarEnabled: false,
    outlookEnabled: false,
    onedriveEnabled: false,
    msCalendarEnabled: false,
    appleCalendarEnabled: false,
    notionEnabled: false,
    clozeEnabled: false,
    slackEnabled: false,
    knowledgeBaseFileIds: [],
  };
}

export function buildIntegrations(step: DraftStep): string[] {
  const integrations: string[] = [];
  if (step.gmailEnabled) integrations.push("gmail");
  if (step.driveEnabled) integrations.push("drive");
  if (step.calendarEnabled) integrations.push("calendar");
  if (step.outlookEnabled) integrations.push("outlook");
  if (step.onedriveEnabled) integrations.push("onedrive");
  if (step.msCalendarEnabled) integrations.push("ms_calendar");
  if (step.appleCalendarEnabled) integrations.push("apple_calendar");
  if (step.notionEnabled) integrations.push("notion");
  if (step.clozeEnabled) integrations.push("cloze");
  if (step.slackEnabled) integrations.push("slack");
  return integrations;
}

export function buildStepsPayload(steps: DraftStep[]) {
  return steps.map((step) => {
    const payload: Record<string, unknown> = {
      prompt: step.prompt.trim(),
      modelId: step.modelId,
      searchMode: step.searchMode,
      webSearchEnabled: step.searchMode !== "none",
      knowledgeBaseFileIds: step.knowledgeBaseFileIds,
    };
    const trimmedTitle = step.title.trim();
    if (trimmedTitle) payload.title = trimmedTitle;
    if (step.selectedPersonaId) payload.personaId = step.selectedPersonaId;
    const integrations = buildIntegrations(step);
    if (integrations.length > 0) payload.enabledIntegrations = integrations;
    if (step.searchMode === "web" || step.searchMode === "research") {
      payload.searchComplexity = Math.max(1, Math.min(3, step.searchComplexity));
    }
    if (step.includeReasoning) {
      payload.includeReasoning = true;
      payload.reasoningEffort = step.reasoningEffort;
    }
    return payload;
  });
}

export function shortModelName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}
