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

export function resolveAvatarImageStorageIdPatch(
  uploadedStorageId: Id<"_storage"> | null | undefined,
  imageWasRemoved: boolean,
): { avatarImageStorageId?: Id<"_storage"> | null } {
  if (uploadedStorageId !== undefined) {
    return { avatarImageStorageId: uploadedStorageId };
  }
  if (imageWasRemoved) {
    return { avatarImageStorageId: null };
  }
  return {};
}

export function parsePersonaMaxTokens(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return null;
  return parsed;
}

function personaMaxTokensForPayload(form: FormState): number | null {
  if (!form.maxTokensEnabled) return null;
  const parsed = parsePersonaMaxTokens(form.maxTokens);
  if (parsed == null) throw new Error("Invalid persona max tokens");
  return parsed;
}

export function buildPersonaMutationPayload(
  form: FormState,
  avatarImageStorageId: Id<"_storage"> | null | undefined,
  avatarImageRemoved: boolean,
) {
  return {
    displayName: form.displayName.trim(),
    personaDescription: form.personaDescription.trim() || null,
    systemPrompt: form.systemPrompt.trim(),
    modelId: form.modelId || undefined,
    temperature: form.temperatureEnabled && form.temperature ? parseFloat(form.temperature) : null,
    maxTokens: personaMaxTokensForPayload(form),
    includeReasoning: form.includeReasoningEnabled ? form.includeReasoning : null,
    reasoningEffort: form.includeReasoningEnabled && form.includeReasoning && form.reasoningEffortEnabled
      ? form.reasoningEffort : null,
    avatarEmoji: form.avatarEmoji || null,
    avatarColor: form.avatarColor || undefined,
    isDefault: form.isDefault,
    skillOverrides: Array.from(form.skillOverrides.entries()).map(([skillId, state]) => ({
      skillId: skillId as Id<"skills">,
      state,
    })),
    integrationOverrides: Array.from(form.integrationOverrides.entries()).map(([integrationId, enabled]) => ({
      integrationId,
      enabled,
    })),
    ...resolveAvatarImageStorageIdPatch(avatarImageStorageId, avatarImageRemoved),
  };
}

/** Cycle tri-state: inherit → always → available → never → inherit */
export function cycleSkillOverride(
  current: SkillOverrideState | undefined,
): SkillOverrideState | undefined {
  if (current === undefined) return "always";
  if (current === "always") return "available";
  if (current === "available") return "never";
  return undefined; // never → inherit
}
