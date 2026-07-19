import type { Id } from "../_generated/dataModel";
import type { SkillOverrideEntry } from "../skills/resolver";
import type { RunGenerationArgs } from "./actions_run_generation_types";
import type { GenerationContinuationGroupSnapshot } from "./generation_continuation_shared";

type ContinuationExtras = {
  subagentBatchId?: Id<"subagentBatches">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
  chatIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  integrationDefaults?: Array<{ integrationId: string; enabled: boolean }>;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
};

export function buildGenerationContinuationGroup(args: {
  generation: RunGenerationArgs;
  requireZdr: boolean;
  enabledIntegrations: string[];
  directToolNames: string[];
  isPro: boolean;
  allowSubagents: boolean;
  chatSkillOverrides?: SkillOverrideEntry[];
  personaSkillOverrides?: SkillOverrideEntry[];
  skillDefaults?: SkillOverrideEntry[];
}): GenerationContinuationGroupSnapshot {
  const generation = args.generation as RunGenerationArgs & ContinuationExtras;
  return {
    assistantMessageIds: generation.assistantMessageIds,
    generationJobIds: generation.generationJobIds,
    userMessageId: generation.userMessageId,
    userId: generation.userId,
    expandMultiModelGroups: generation.expandMultiModelGroups,
    webSearchEnabled: generation.webSearchEnabled,
    requireZdrOverride: args.requireZdr,
    effectiveIntegrations: args.enabledIntegrations,
    directToolNames: args.directToolNames,
    isPro: args.isPro,
    allowSubagents: args.allowSubagents,
    disableTools: generation.disableTools,
    searchSessionId: generation.searchSessionId,
    subagentBatchId: generation.subagentBatchId,
    drivePickerBatchId: generation.drivePickerBatchId,
    executionAttemptId: generation.executionAttemptId,
    executionFence: generation.executionFence,
    imageConfig: generation.imageConfig,
    chatSkillOverrides: args.chatSkillOverrides,
    chatIntegrationOverrides: generation.chatIntegrationOverrides,
    personaSkillOverrides: args.personaSkillOverrides,
    skillDefaults: args.skillDefaults,
    integrationDefaults: generation.integrationDefaults,
    analytics: generation.analytics,
    analyticsSource: generation.analyticsSource,
  };
}
