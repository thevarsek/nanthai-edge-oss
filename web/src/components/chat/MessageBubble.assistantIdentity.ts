import type { Message, Participant } from "@/hooks/useChat";

interface AssistantDisplayIdentityArgs {
  message: Pick<Message, "modelId" | "participantId" | "participantName" | "participantEmoji" | "participantAvatarImageUrl">;
  participants: Participant[];
  modelDisplayName: string;
}

export interface AssistantDisplayIdentity {
  personaId?: string;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  label: string;
  hasPersonaDisplay: boolean;
}

function present(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function participantMatchesPersistedId(participant: Participant, persistedId: string): boolean {
  return participant.id === persistedId || participant.personaId === persistedId;
}

export function getAssistantDisplayIdentity({
  message,
  participants,
  modelDisplayName,
}: AssistantDisplayIdentityArgs): AssistantDisplayIdentity {
  const persistedId = present(message.participantId);
  const persistedName = present(message.participantName);
  const persistedEmoji = present(message.participantEmoji);
  const persistedAvatarUrl = present(message.participantAvatarImageUrl);
  const hasPersistedIdentity = !!(persistedId || persistedName || persistedEmoji || persistedAvatarUrl);

  const matchedById = persistedId
    ? participants.find((participant) => participantMatchesPersistedId(participant, persistedId))
    : undefined;
  const matchedByName = persistedName && message.modelId
    ? participants.find((participant) =>
        participant.modelId === message.modelId && present(participant.personaName) === persistedName
      )
    : undefined;
  const matchedByModel = !hasPersistedIdentity && message.modelId
    ? participants.find((participant) => participant.modelId === message.modelId)
    : undefined;
  const matchedParticipant = matchedById ?? matchedByName ?? matchedByModel;

  const personaId = persistedId ?? present(matchedParticipant?.personaId);
  const personaName = persistedName ?? present(matchedParticipant?.personaName);
  const personaEmoji = persistedEmoji ?? present(matchedParticipant?.personaEmoji);
  const personaAvatarImageUrl = persistedAvatarUrl ?? present(matchedParticipant?.personaAvatarImageUrl);

  return {
    personaId,
    personaName,
    personaEmoji,
    personaAvatarImageUrl,
    label: personaName ?? modelDisplayName,
    hasPersonaDisplay: !!(personaName || personaEmoji || personaAvatarImageUrl),
  };
}
