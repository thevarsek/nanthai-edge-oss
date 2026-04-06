import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "../hooks/useChat";

const DEFAULT_TEMPERATURE = 0.7;

export interface SharedPreferences {
  defaultModelId?: string;
  defaultPersonaId?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string;
  autoAudioResponse?: boolean;
  subagentsEnabledByDefault?: boolean;
  webSearchEnabledByDefault?: boolean;
  defaultSearchMode?: string;
  defaultSearchComplexity?: number;
  defaultAudioSpeed?: number;
  hasSeenIdeascapeHelp?: boolean;
  showBalanceInChat?: boolean;
  showAdvancedStats?: boolean;
}

export interface SharedPersona {
  _id: Id<"personas"> | string;
  modelId?: string | null;
  displayName?: string | null;
  avatarEmoji?: string | null;
  avatarImageUrl?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  includeReasoning?: boolean | null;
  reasoningEffort?: string | null;
  discoverableSkillIds?: string[] | null;
}

export interface SharedModelSettings {
  openRouterId: string;
  temperature?: number | null;
  maxTokens?: number | null;
  includeReasoning?: boolean | null;
  reasoningEffort?: string | null;
}

export interface BaseParticipant {
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
}

export interface ParameterOverrides {
  temperatureMode: "default" | "override";
  temperature: number;
  maxTokensMode: "default" | "override";
  maxTokens?: number;
  reasoningMode: "default" | "on" | "off";
  reasoningEffort: "low" | "medium" | "high";
}

export interface ParameterDefaults {
  temperature: number;
  maxTokens?: number;
  includeReasoning: boolean;
  reasoningEffort: string;
  autoAudioResponse: boolean;
}

export const DEFAULT_PARAMETER_OVERRIDES: ParameterOverrides = {
  temperatureMode: "default",
  temperature: DEFAULT_TEMPERATURE,
  maxTokensMode: "default",
  maxTokens: undefined,
  reasoningMode: "default",
  reasoningEffort: "medium",
};

export function findDefaultPersona(
  personas: SharedPersona[] | undefined,
  prefs: SharedPreferences | undefined,
): SharedPersona | null {
  const personaId = prefs?.defaultPersonaId;
  if (!personaId || !personas) return null;
  return personas.find((persona) => persona._id === personaId) ?? null;
}

export function resolveParameterDefaults(
  modelId: string,
  prefs: SharedPreferences | undefined,
  modelSettings: SharedModelSettings[] | undefined,
): ParameterDefaults {
  const matchingSettings = modelSettings?.find((setting) => setting.openRouterId === modelId);
  return {
    temperature: matchingSettings?.temperature ?? prefs?.defaultTemperature ?? DEFAULT_TEMPERATURE,
    maxTokens: matchingSettings?.maxTokens ?? prefs?.defaultMaxTokens,
    includeReasoning: matchingSettings?.includeReasoning ?? prefs?.includeReasoning ?? true,
    reasoningEffort: matchingSettings?.reasoningEffort ?? prefs?.reasoningEffort ?? "medium",
    autoAudioResponse: prefs?.autoAudioResponse ?? false,
  };
}

export function resolveParticipants(args: {
  baseParticipants: BaseParticipant[];
  personas: SharedPersona[] | undefined;
  prefs: SharedPreferences | undefined;
  modelSettings: SharedModelSettings[] | undefined;
  overrides: ParameterOverrides;
}): Participant[] {
  const { baseParticipants, personas, prefs, modelSettings, overrides } = args;
  return baseParticipants.map((participant) => {
    const persona = participant.personaId
      ? personas?.find((item) => item._id === participant.personaId)
      : undefined;
    const defaults = resolveParameterDefaults(participant.modelId, prefs, modelSettings);
    const includeReasoning = overrides.reasoningMode === "on"
      ? true
      : overrides.reasoningMode === "off"
        ? false
        : persona?.includeReasoning ?? defaults.includeReasoning;
    const reasoningEffort = includeReasoning
      ? overrides.reasoningMode === "on"
        ? overrides.reasoningEffort
        : persona?.reasoningEffort ?? defaults.reasoningEffort
      : null;
    return {
      ...participant,
      temperature: overrides.temperatureMode === "override"
        ? overrides.temperature
        : persona?.temperature ?? defaults.temperature,
      maxTokens: overrides.maxTokensMode === "override"
        ? overrides.maxTokens
        : persona?.maxTokens ?? defaults.maxTokens,
      includeReasoning,
      reasoningEffort,
    };
  });
}

export function buildBaseParticipants(args: {
  convexParticipants: BaseParticipant[];
  defaultPersona: SharedPersona | null;
  selectedModelId: string;
}): BaseParticipant[] {
  const { convexParticipants, defaultPersona, selectedModelId } = args;
  if (convexParticipants.length > 0) {
    return convexParticipants.map((participant) => ({
      modelId: participant.modelId,
      personaId: participant.personaId,
      personaName: participant.personaName,
      personaEmoji: participant.personaEmoji,
      personaAvatarImageUrl: participant.personaAvatarImageUrl,
    }));
  }
  if (defaultPersona) {
    return [{
      modelId: defaultPersona.modelId ?? selectedModelId,
      personaId: defaultPersona._id as Id<"personas">,
      personaName: defaultPersona.displayName ?? null,
      personaEmoji: defaultPersona.avatarEmoji ?? null,
      personaAvatarImageUrl: defaultPersona.avatarImageUrl ?? null,
    }];
  }
  return [{ modelId: selectedModelId, personaId: null }];
}

export function validateSendState(args: {
  participantCount: number;
  isResearchPaper: boolean;
  attachmentCount: number;
  complexity?: number;
}): string | null {
  const { participantCount, isResearchPaper, attachmentCount, complexity } = args;
  if (participantCount > 1 && isResearchPaper) {
    return "Research Paper requires a single participant.";
  }
  if ((complexity ?? 1) === 3 && attachmentCount > 0) {
    return "Complexity 3 search does not support attachments.";
  }
  return null;
}
