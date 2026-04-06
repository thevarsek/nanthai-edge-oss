import { Id } from "../_generated/dataModel";

export type ScheduledJobSearchMode = "none" | "basic" | "web" | "research";

export interface ScheduledJobStepConfig {
  title?: string;
  prompt: string;
  modelId: string;
  personaId?: Id<"personas">;
  enabledIntegrations?: string[];
  webSearchEnabled?: boolean;
  searchMode?: ScheduledJobSearchMode;
  searchComplexity?: number;
  knowledgeBaseFileIds?: Id<"_storage">[];
  includeReasoning?: boolean;
  reasoningEffort?: string;
}

interface LegacyScheduledJobShape {
  prompt: string;
  modelId: string;
  personaId?: Id<"personas">;
  enabledIntegrations?: string[];
  webSearchEnabled?: boolean;
  searchMode?: string;
  searchComplexity?: number;
  knowledgeBaseFileIds?: Id<"_storage">[];
  includeReasoning?: boolean;
  reasoningEffort?: string;
  steps?: ScheduledJobStepConfig[];
}

const MAX_KB_CONTEXT_CHARS = 50_000;

export function getScheduledJobSteps(
  job: LegacyScheduledJobShape,
): ScheduledJobStepConfig[] {
  if (job.steps && job.steps.length > 0) {
    return job.steps.map((step) => ({
      ...step,
      searchMode: resolveScheduledJobSearchMode(step),
      searchComplexity: normalizeSearchComplexity(step.searchComplexity),
    }));
  }

  return [{
    prompt: job.prompt,
    modelId: job.modelId,
    personaId: job.personaId,
    enabledIntegrations: job.enabledIntegrations,
    webSearchEnabled: job.webSearchEnabled,
    searchMode: resolveScheduledJobSearchMode(job),
    searchComplexity: normalizeSearchComplexity(job.searchComplexity),
    knowledgeBaseFileIds: job.knowledgeBaseFileIds,
    includeReasoning: job.includeReasoning,
    reasoningEffort: job.reasoningEffort,
  }];
}

export function resolveScheduledJobSearchMode(job: {
  searchMode?: string;
  webSearchEnabled?: boolean;
}): ScheduledJobSearchMode {
  if (
    job.searchMode === "none"
    || job.searchMode === "basic"
    || job.searchMode === "web"
    || job.searchMode === "research"
  ) {
    return job.searchMode;
  }
  return job.webSearchEnabled ? "basic" : "none";
}

export function normalizeSearchComplexity(
  value?: number,
): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(1, Math.min(3, Math.round(value)));
}

export function buildPromptWithKB(
  prompt: string,
  kbFiles: Array<{ storageId: string; content: string }>,
): string {
  let kbContext = "";
  for (const file of kbFiles) {
    const remaining = MAX_KB_CONTEXT_CHARS - kbContext.length;
    if (remaining <= 0) break;
    const chunk = file.content.slice(0, remaining);
    kbContext += `\n--- Knowledge Base File ---\n${chunk}\n`;
  }

  if (!kbContext) return prompt;
  return `[Knowledge Base Context]\n${kbContext.trim()}\n\n[Task]\n${prompt}`;
}

export function buildStepTriggerPrompt(
  step: ScheduledJobStepConfig,
  previousAssistantContent?: string,
): string {
  if (!previousAssistantContent?.trim()) {
    return step.prompt;
  }

  return [
    step.prompt.trim(),
    "",
    "[Previous Step Output]",
    previousAssistantContent.trim(),
  ].join("\n");
}

export function getStepTitle(
  step: ScheduledJobStepConfig,
  stepIndex: number,
): string {
  const title = step.title?.trim();
  if (title) return title;
  return `Step ${stepIndex + 1}`;
}

export function mirrorFirstStep(
  steps: ScheduledJobStepConfig[],
): Pick<
  ScheduledJobStepConfig,
  | "prompt"
  | "modelId"
  | "personaId"
  | "enabledIntegrations"
  | "webSearchEnabled"
  | "searchMode"
  | "searchComplexity"
  | "knowledgeBaseFileIds"
  | "includeReasoning"
  | "reasoningEffort"
> {
  const firstStep = steps[0];
  return {
    prompt: firstStep.prompt,
    modelId: firstStep.modelId,
    personaId: firstStep.personaId,
    enabledIntegrations: firstStep.enabledIntegrations,
    webSearchEnabled:
      firstStep.webSearchEnabled
      ?? (resolveScheduledJobSearchMode(firstStep) !== "none"),
    searchMode: resolveScheduledJobSearchMode(firstStep),
    searchComplexity: normalizeSearchComplexity(firstStep.searchComplexity),
    knowledgeBaseFileIds: firstStep.knowledgeBaseFileIds,
    includeReasoning: firstStep.includeReasoning,
    reasoningEffort: firstStep.reasoningEffort,
  };
}
