import type { Id } from "@convex/_generated/dataModel";

export const INTEGRATION_KEYS = [
  "gmail", "drive", "calendar",
  "outlook", "onedrive", "msCalendar",
  "appleCalendar", "notion",
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
