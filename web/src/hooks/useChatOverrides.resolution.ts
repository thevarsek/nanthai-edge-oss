import type { ChatParameterOverrides } from "@/components/chat/ChatParametersDrawer";
import type { PlusMenuItem } from "@/components/chat/ChatPlusMenu";
import type { Chat } from "@/hooks/useChat";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";

export type SkillOverrideState = "always" | "available" | "never";

export const DEFAULT_OVERRIDES: ChatParameterOverrides = {
  temperatureMode: "default",
  temperature: 1.0,
  maxTokensMode: "default",
  maxTokens: undefined,
  reasoningMode: "default",
  reasoningEffort: "medium",
  autoAudioResponseMode: "default",
};

export interface SkillPersonaSource {
  skillOverrides?: Array<{ skillId: string; state: SkillOverrideState }> | null;
  integrationOverrides?: Array<{ integrationId: string; enabled: boolean }> | null;
}

export function mapEquals<V>(a: Map<string, V>, b: Map<string, V>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, val] of a) {
    if (b.get(key) !== val) return false;
  }
  return true;
}

export function chatOverridesFromChat(chat: Chat | null | undefined): ChatParameterOverrides {
  return {
    temperatureMode: chat?.temperatureOverride == null ? "default" : "override",
    temperature: chat?.temperatureOverride ?? DEFAULT_OVERRIDES.temperature,
    maxTokensMode: chat?.maxTokensOverride == null ? "default" : "override",
    maxTokens: chat?.maxTokensOverride ?? undefined,
    reasoningMode:
      chat?.includeReasoningOverride == null
        ? "default"
        : chat.includeReasoningOverride
          ? "on"
          : "off",
    reasoningEffort: (chat?.reasoningEffortOverride as ChatParameterOverrides["reasoningEffort"] | undefined)
      ?? DEFAULT_OVERRIDES.reasoningEffort,
    autoAudioResponseMode:
      chat?.autoAudioResponseOverride == null
        ? "default"
        : chat.autoAudioResponseOverride === "enabled"
          ? "on"
          : "off",
  };
}

export function skillOverridesFromChat(
  chat: Chat | null | undefined,
  personaDefaults: Map<string, SkillOverrideState>,
): Map<string, SkillOverrideState> {
  const result = new Map(personaDefaults);
  for (const entry of chat?.skillOverrides ?? []) {
    result.set(entry.skillId, entry.state);
  }
  return result;
}

export function integrationOverridesFromChat(
  chat: Chat | null | undefined,
  personaDefaults: Map<string, boolean>,
): Map<string, boolean> {
  if (chat?.integrationOverrides && chat.integrationOverrides.length > 0) {
    const result = new Map(personaDefaults);
    for (const entry of chat.integrationOverrides) {
      result.set(entry.integrationId, entry.enabled);
    }
    return result;
  }
  return new Map(personaDefaults);
}

export function personaSkillDefaults(persona: SkillPersonaSource | null): Map<string, SkillOverrideState> {
  if (!persona) return new Map();
  return new Map((persona.skillOverrides ?? []).map((entry) => [entry.skillId, entry.state]));
}

export function personaIntegrationDefaults(persona: SkillPersonaSource | null): Map<string, boolean> {
  if (!persona) return new Map();
  return new Map((persona.integrationOverrides ?? []).map((entry) => [entry.integrationId, entry.enabled]));
}

export function enabledSkillIdsFromOverrides(overrides: Map<string, SkillOverrideState>): Set<string> {
  const result = new Set<string>();
  for (const [id, state] of overrides) {
    if (state === "always" || state === "available") result.add(id);
  }
  return result;
}

export function enabledIntegrationKeysFromOverrides(overrides: Map<string, boolean>): Set<IntegrationKey> {
  const result = new Set<IntegrationKey>();
  for (const [key, enabled] of overrides) {
    if (enabled) result.add(key as IntegrationKey);
  }
  return result;
}

export function cycleSkillState(current: SkillOverrideState | undefined): SkillOverrideState | undefined {
  switch (current) {
    case undefined: return "always";
    case "always": return "available";
    case "available": return "never";
    case "never": return undefined;
  }
}

export function buildOverrideBadges(args: {
  paramOverrides: ChatParameterOverrides;
  enabledIntegrations: Set<IntegrationKey>;
  enabledSkillIds: Set<string>;
  selectedKBFileIds: Set<string>;
}): Partial<Record<PlusMenuItem, number>> {
  const hasParamOverride =
    args.paramOverrides.temperatureMode === "override" ||
    args.paramOverrides.maxTokensMode === "override" ||
    args.paramOverrides.reasoningMode !== "default";
  return {
    parameters: hasParamOverride ? 1 : 0,
    integrations: args.enabledIntegrations.size,
    skills: args.enabledSkillIds.size,
    knowledgeBase: args.selectedKBFileIds.size,
  };
}
