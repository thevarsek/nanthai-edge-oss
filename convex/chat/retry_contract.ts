import { Id } from "../_generated/dataModel";

export type RetrySearchMode = "none" | "normal" | "web";

export interface RetryParticipantSnapshot {
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  systemPrompt?: string | null;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string | null;
}

export interface RetryVideoConfig {
  resolution?: string;
  aspectRatio?: string;
  duration?: number;
  generateAudio?: boolean;
}

export interface RetryContract {
  participants: RetryParticipantSnapshot[];
  searchMode: RetrySearchMode;
  searchComplexity?: number;
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
  turnSkillOverrides?: Array<{
    skillId: Id<"skills">;
    state: "always" | "available" | "never";
  }>;
  turnIntegrationOverrides?: Array<{
    integrationId: string;
    enabled: boolean;
  }>;
  videoConfig?: RetryVideoConfig;
}

function cloneParticipant(
  participant: RetryParticipantSnapshot,
): RetryParticipantSnapshot {
  return {
    modelId: participant.modelId,
    personaId: participant.personaId ?? null,
    personaName: participant.personaName ?? null,
    personaEmoji: participant.personaEmoji ?? null,
    personaAvatarImageUrl: participant.personaAvatarImageUrl ?? null,
    systemPrompt: participant.systemPrompt ?? null,
    temperature: participant.temperature,
    maxTokens: participant.maxTokens,
    includeReasoning: participant.includeReasoning,
    reasoningEffort: participant.reasoningEffort ?? null,
  };
}

export function cloneRetryContract(contract: RetryContract): RetryContract {
  return {
    participants: contract.participants.map(cloneParticipant),
    searchMode: contract.searchMode,
    searchComplexity: contract.searchComplexity,
    enabledIntegrations: contract.enabledIntegrations
      ? [...contract.enabledIntegrations]
      : undefined,
    subagentsEnabled: contract.subagentsEnabled,
    turnSkillOverrides: contract.turnSkillOverrides
      ? contract.turnSkillOverrides.map((entry) => ({ ...entry }))
      : undefined,
    turnIntegrationOverrides: contract.turnIntegrationOverrides
      ? contract.turnIntegrationOverrides.map((entry) => ({ ...entry }))
      : undefined,
    videoConfig: contract.videoConfig ? { ...contract.videoConfig } : undefined,
  };
}

export function buildRetryContract(args: RetryContract): RetryContract {
  return cloneRetryContract({
    ...args,
    participants: args.participants.map(cloneParticipant),
    searchMode: args.searchMode,
    searchComplexity:
      args.searchMode === "web" ? args.searchComplexity : undefined,
  });
}
