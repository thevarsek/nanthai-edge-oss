import type { Id } from "@convex/_generated/dataModel";
import type { SkillOverrideState } from "@/hooks/useChatOverrides";

export type { SkillOverrideState };

export const INTEGRATION_KEYS = [
  "gmail", "drive", "calendar",
  "outlook", "onedrive", "ms_calendar",
  "apple_calendar", "notion", "cloze", "slack",
] as const;

export type IntegrationKey = (typeof INTEGRATION_KEYS)[number];

export interface FormState {
  displayName: string;
  personaDescription: string;
  systemPrompt: string;
  modelId: string;
  temperatureEnabled: boolean;
  temperature: string;
  maxTokensEnabled: boolean;
  maxTokens: string;
  includeReasoningEnabled: boolean;
  includeReasoning: boolean;
  reasoningEffortEnabled: boolean;
  reasoningEffort: "low" | "medium" | "high";
  avatarEmoji: string;
  avatarColor: string;
  isDefault: boolean;
  enabledIntegrations: Set<IntegrationKey>;
  selectedSkillIds: Set<Id<"skills">>;
  /** M30: tri-state skill overrides (inherit = not in map) */
  skillOverrides: Map<string, SkillOverrideState>;
  /** M30: integration overrides (inherit = not in map) */
  integrationOverrides: Map<string, boolean>;
}

export function defaultForm(): FormState {
  return {
    displayName: "",
    personaDescription: "",
    systemPrompt: "",
    modelId: "",
    temperatureEnabled: false,
    temperature: "1.0",
    maxTokensEnabled: false,
    maxTokens: "",
    includeReasoningEnabled: false,
    includeReasoning: true,
    reasoningEffortEnabled: false,
    reasoningEffort: "medium",
    avatarEmoji: "🤖",
    avatarColor: "#6366f1",
    isDefault: false,
    enabledIntegrations: new Set(),
    selectedSkillIds: new Set(),
    skillOverrides: new Map(),
    integrationOverrides: new Map(),
  };
}

export function integrationSetFromArray(arr: string[] | undefined): Set<IntegrationKey> {
  if (!arr) return new Set();
  const valid = new Set<string>(INTEGRATION_KEYS);
  return new Set(arr.filter((k) => valid.has(k)) as IntegrationKey[]);
}

export function integrationSetToArray(s: Set<IntegrationKey>): string[] {
  return Array.from(s);
}

/** Cycle tri-state: inherit → available → always → never → inherit */
export function cycleSkillOverride(
  current: SkillOverrideState | undefined,
): SkillOverrideState | undefined {
  if (current === undefined) return "available";
  if (current === "available") return "always";
  if (current === "always") return "never";
  return undefined; // never → inherit
}
