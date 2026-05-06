import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";

export function buildRegeneratePaperArgs(args: {
  sessionId: string;
  participant: Participant;
  enabledIntegrations: ReadonlySet<string>;
}) {
  const { sessionId, participant, enabledIntegrations } = args;
  return {
    sessionId: sessionId as Id<"searchSessions">,
    modelId: participant.modelId,
    ...(participant.personaId ? { personaId: participant.personaId } : {}),
    ...(participant.personaName ? { personaName: participant.personaName } : {}),
    ...(participant.personaEmoji ? { personaEmoji: participant.personaEmoji } : {}),
    ...(participant.personaAvatarImageUrl ? { personaAvatarImageUrl: participant.personaAvatarImageUrl } : {}),
    ...(participant.temperature != null ? { temperature: participant.temperature } : {}),
    ...(participant.maxTokens != null ? { maxTokens: participant.maxTokens } : {}),
    ...(participant.includeReasoning != null ? { includeReasoning: participant.includeReasoning } : {}),
    ...(participant.reasoningEffort ? { reasoningEffort: participant.reasoningEffort } : {}),
    ...(enabledIntegrations.size > 0 ? { enabledIntegrations: Array.from(enabledIntegrations) } : {}),
  };
}
