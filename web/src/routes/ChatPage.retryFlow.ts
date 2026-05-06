import type { Id } from "@convex/_generated/dataModel";
import type { Message, Participant, UseChatReturn } from "@/hooks/useChat";
import type { IntegrationKey } from "@/routes/PersonaEditorForm";
import { getRetryBaseParticipant } from "@/routes/ChatPage.flow";

const GOOGLE_INTEGRATION_IDS = new Set(["gmail", "drive", "calendar"]);

export function retryGoogleIntegrationsAreActive(message: Message | undefined): boolean {
  const enabledIntegrations =
    message?.retryContract?.enabledIntegrations
    ?? message?.enabledIntegrations
    ?? [];
  return enabledIntegrations.some((integrationId) => GOOGLE_INTEGRATION_IDS.has(integrationId));
}

export function buildRetryMessageArgs(args: {
  messageId: Id<"messages">;
  targetMessage: Message | undefined;
  convexSearchMode?: "normal" | "web";
  convexComplexity?: number;
  enabledIntegrations: Set<IntegrationKey>;
  turnSkillOverrideEntries: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  turnIntegrationOverrideEntries: Array<{ integrationId: string; enabled: boolean }>;
  effectiveSubagentsEnabled?: boolean;
}): Parameters<UseChatReturn["retryMessage"]>[0] {
  if (args.targetMessage?.retryContract) {
    return { messageId: args.messageId };
  }
  return {
    messageId: args.messageId,
    ...(args.convexSearchMode ? { searchMode: args.convexSearchMode } : {}),
    ...(args.convexComplexity ? { complexity: args.convexComplexity } : {}),
    ...(args.enabledIntegrations.size > 0
      ? { enabledIntegrations: Array.from(args.enabledIntegrations) }
      : {}),
    ...(args.turnSkillOverrideEntries.length > 0
      ? { turnSkillOverrides: args.turnSkillOverrideEntries }
      : {}),
    ...(args.turnIntegrationOverrideEntries.length > 0
      ? { turnIntegrationOverrides: args.turnIntegrationOverrideEntries }
      : {}),
    ...(args.effectiveSubagentsEnabled !== undefined
      ? { subagentsEnabled: args.effectiveSubagentsEnabled }
      : {}),
  };
}

export function retryParticipantWithModel(
  baseParticipant: Participant,
  modelId: string,
): Participant {
  return {
    ...baseParticipant,
    modelId,
    personaId: null,
    personaName: null,
    personaEmoji: null,
    personaAvatarImageUrl: null,
  };
}

export function retryParticipantWithPersona(args: {
  baseParticipant: Participant;
  personaId: string;
  personas: Array<{
    _id: string;
    modelId?: string | null;
    displayName?: string | null;
    avatarEmoji?: string | null;
    avatarImageUrl?: string | null;
  }> | undefined;
}): Participant {
  const persona = args.personas?.find((entry) => entry._id === args.personaId);
  return {
    ...args.baseParticipant,
    modelId: persona?.modelId ?? args.baseParticipant.modelId,
    personaId: args.personaId as Id<"personas">,
    personaName: persona?.displayName ?? null,
    personaEmoji: persona?.avatarEmoji ?? null,
    personaAvatarImageUrl: persona?.avatarImageUrl ?? null,
  };
}

export function retryBaseParticipantForMessage(message: Message | undefined): Participant {
  return getRetryBaseParticipant(message);
}
