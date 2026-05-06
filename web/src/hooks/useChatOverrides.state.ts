import type { Id } from "@convex/_generated/dataModel";
import type { ChatParameterOverrides } from "@/components/chat/ChatParametersDrawer";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import { cycleSkillState, mapEquals, type SkillOverrideState } from "@/hooks/useChatOverrides.resolution";

export function pendingParamOverridesConverged(
  pending: ChatParameterOverrides | null,
  resolved: ChatParameterOverrides,
): boolean {
  return !!pending && JSON.stringify(pending) === JSON.stringify(resolved);
}

export function pendingMapConverged<V>(
  pending: Map<string, V> | null,
  resolved: Map<string, V>,
): boolean {
  return !!pending && mapEquals(pending, resolved);
}

export function nextCycledSkillOverrides(
  current: Map<string, SkillOverrideState>,
  skillId: string,
): Map<string, SkillOverrideState> {
  const next = new Map(current);
  const newState = cycleSkillState(next.get(skillId));
  if (newState === undefined) next.delete(skillId);
  else next.set(skillId, newState);
  return next;
}

export function nextToggledSkillOverrides(
  current: Map<string, SkillOverrideState>,
  skillId: string,
): Map<string, SkillOverrideState> {
  const next = new Map(current);
  const currentState = next.get(skillId);
  if (currentState === "always" || currentState === "available") {
    next.delete(skillId);
  } else {
    next.set(skillId, "available");
  }
  return next;
}

export function nextToggledIntegrationOverrides(
  current: Map<string, boolean>,
  key: IntegrationKey,
): Map<string, boolean> {
  const next = new Map(current);
  const isEnabled = next.get(key);
  if (isEnabled === true) next.set(key, false);
  else next.set(key, true);
  return next;
}

export function serializeSkillOverrideEntries(
  overrides: Map<string, SkillOverrideState>,
): Array<{ skillId: Id<"skills">; state: SkillOverrideState }> {
  return Array.from(overrides, ([skillId, state]) => ({ skillId: skillId as Id<"skills">, state }));
}

export function serializeIntegrationOverrideEntries(
  overrides: Map<string, boolean>,
): Array<{ integrationId: string; enabled: boolean }> {
  return Array.from(overrides, ([integrationId, enabled]) => ({ integrationId, enabled }));
}

export function buildFlushPlan(args: {
  chatId: Id<"chats"> | undefined;
  draftParamDirty: boolean;
  draftSkillDirty: boolean;
  draftIntegrationDirty: boolean;
  pendingParamOverrides: ChatParameterOverrides | null;
  pendingSkillOverrides: Map<string, SkillOverrideState> | null;
  pendingIntegrationOverrides: Map<string, boolean> | null;
}) {
  if (!args.chatId) {
    return {
      parameters: args.draftParamDirty,
      skills: args.draftSkillDirty,
      integrations: args.draftIntegrationDirty,
    };
  }
  return {
    parameters: !!args.pendingParamOverrides,
    skills: !!args.pendingSkillOverrides,
    integrations: !!args.pendingIntegrationOverrides,
  };
}
