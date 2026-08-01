import { SCHEDULED_JOB_DEFAULT_MODEL_ID } from "../lib/modelDefaults";
import { isProviderAllowedForGoogle } from "@/components/shared/ModelPickerShared";

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
  remoteMcpIntegrationIds: string[];
  knowledgeBaseFileIds: string[];
}

export const SCHEDULED_JOB_DEFAULT_MODEL = SCHEDULED_JOB_DEFAULT_MODEL_ID;
export const SCHEDULED_JOB_GOOGLE_MODEL_MESSAGE_KEY = "google_integration_blocked_by_model";
const SCHEDULED_JOB_INTEGRATION_IDS = [
  "gmail",
  "drive",
  "calendar",
  "outlook",
  "onedrive",
  "ms_calendar",
  "apple_calendar",
  "notion",
  "cloze",
  "slack",
] as const;

export interface ScheduledJobIntegrationOverride {
  integrationId: string;
  enabled: boolean;
}

export interface ScheduledJobEditorJobDoc {
  prompt?: string;
  modelId?: string;
  personaId?: string;
  enabledIntegrations?: string[];
  steps?: Array<Record<string, unknown>>;
  searchMode?: string;
  searchComplexity?: number;
  webSearchEnabled?: boolean;
  includeReasoning?: boolean;
  reasoningEffort?: string;
  knowledgeBaseFileIds?: string[];
}

export interface ScheduledJobModelCompatibilitySummary {
  modelId: string;
  provider?: string | null;
  hasZdrEndpoint?: boolean | null;
}

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
    remoteMcpIntegrationIds: [],
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
  integrations.push(...step.remoteMcpIntegrationIds.slice().sort());
  return integrations;
}

export function integrationsFromOverrides(
  enabledIntegrations?: readonly string[],
  turnIntegrationOverrides?: readonly ScheduledJobIntegrationOverride[],
): string[] {
  if (turnIntegrationOverrides && turnIntegrationOverrides.length > 0) {
    return turnIntegrationOverrides
      .filter((entry) => entry.enabled)
      .map((entry) => entry.integrationId);
  }
  return [...(enabledIntegrations ?? [])];
}

export function hasScheduledJobGoogleIntegrations(step: DraftStep): boolean {
  return step.gmailEnabled || step.driveEnabled || step.calendarEnabled;
}

export function scheduledJobModelSupportsGoogleIntegrations(
  modelId: string,
  summary?: ScheduledJobModelCompatibilitySummary | null,
): boolean {
  return summary?.hasZdrEndpoint === true
    && isProviderAllowedForGoogle(modelId, summary.provider);
}

export function buildIntegrationOverrides(
  step: DraftStep,
  knownRemoteMcpIntegrationIds: ReadonlySet<string> = new Set(step.remoteMcpIntegrationIds),
): Array<{ integrationId: string; enabled: boolean }> {
  const enabled = new Set(buildIntegrations(step));
  const staticOverrides = SCHEDULED_JOB_INTEGRATION_IDS.map((integrationId) => ({
    integrationId,
    enabled: enabled.has(integrationId),
  }));
  const remoteOverrides = Array.from(knownRemoteMcpIntegrationIds).sort().map((integrationId) => ({
    integrationId,
    enabled: enabled.has(integrationId),
  }));
  return [...staticOverrides, ...remoteOverrides];
}

export function buildStepsPayload(
  steps: DraftStep[],
  knownRemoteMcpIntegrationIds?: ReadonlySet<string>,
) {
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
    payload.enabledIntegrations = integrations;
    payload.turnIntegrationOverrides = buildIntegrationOverrides(step, knownRemoteMcpIntegrationIds);
    if (step.searchMode === "web" || step.searchMode === "research") {
      payload.searchComplexity = Math.max(1, Math.min(3, step.searchComplexity));
    }
    payload.includeReasoning = step.includeReasoning;
    if (step.includeReasoning) {
      payload.reasoningEffort = step.reasoningEffort;
    }
    return payload;
  });
}

export function shortModelName(modelId: string): string {
  return modelId.split("/").pop() ?? modelId;
}

function normalizeSearchComplexity(v?: number): number {
  return Math.max(1, Math.min(3, Math.round(v ?? 1)));
}

function draftStepFromRaw(raw: Record<string, unknown>): DraftStep {
  const integrations = integrationsFromOverrides(
    raw.enabledIntegrations as string[] | undefined,
    raw.turnIntegrationOverrides as ScheduledJobIntegrationOverride[] | undefined,
  );
  return {
    ...createDraftStep(),
    title: (raw.title as string) ?? "",
    prompt: (raw.prompt as string) ?? "",
    modelId: (raw.modelId as string) ?? SCHEDULED_JOB_DEFAULT_MODEL,
    selectedPersonaId: (raw.personaId as string) ?? null,
    searchMode: ((raw.searchMode as string) ?? (raw.webSearchEnabled ? "basic" : "none")) as SearchMode,
    searchComplexity: normalizeSearchComplexity(raw.searchComplexity as number | undefined),
    includeReasoning: (raw.includeReasoning as boolean) ?? false,
    reasoningEffort: (raw.reasoningEffort as string) ?? "medium",
    gmailEnabled: integrations.includes("gmail"),
    driveEnabled: integrations.includes("drive"),
    calendarEnabled: integrations.includes("calendar"),
    outlookEnabled: integrations.includes("outlook"),
    onedriveEnabled: integrations.includes("onedrive"),
    msCalendarEnabled: integrations.includes("ms_calendar"),
    appleCalendarEnabled: integrations.includes("apple_calendar"),
    notionEnabled: integrations.includes("notion"),
    clozeEnabled: integrations.includes("cloze"),
    slackEnabled: integrations.includes("slack"),
    remoteMcpIntegrationIds: integrations.filter((integrationId) => integrationId.startsWith("mcp:")),
    knowledgeBaseFileIds: (raw.knowledgeBaseFileIds as string[] | undefined) ?? [],
  };
}

export function jobToSteps(job: ScheduledJobEditorJobDoc): DraftStep[] {
  if (job.steps && job.steps.length > 0) {
    return job.steps.map(draftStepFromRaw);
  }
  return [draftStepFromRaw(job as Record<string, unknown>)];
}
