interface ParticipantIdentity {
  id?: string | null;
}

function legacyIndexFromId(participantId: string): number | null {
  if (!/^\d+$/.test(participantId)) return null;
  return Number(participantId);
}

export function participantKey(participant: ParticipantIdentity, index: number): string {
  return participant.id ?? String(index);
}

export function buildParticipantIndexById<T extends ParticipantIdentity>(
  participants: T[],
): Map<string, number> {
  return new Map(
    participants.map((participant, index) => [participantKey(participant, index), index]),
  );
}

export function resolveSelectedParticipantId<T extends ParticipantIdentity>(
  selectedId: string | null,
  participants: T[],
): string | null {
  if (!selectedId) return null;
  if (participants.some((participant) => participant.id === selectedId)) return selectedId;

  const index = legacyIndexFromId(selectedId);
  if (index === null || index < 0 || index >= participants.length) return null;
  return participantKey(participants[index], index);
}

export function participantIndexForId<T extends ParticipantIdentity>(
  participantId: string,
  participants: T[],
): number | undefined {
  const byId = buildParticipantIndexById(participants);
  const byStableId = byId.get(participantId);
  if (byStableId !== undefined) return byStableId;

  const fallbackIndex = legacyIndexFromId(participantId);
  if (
    fallbackIndex === null ||
    fallbackIndex < 0 ||
    fallbackIndex >= participants.length
  ) {
    return undefined;
  }
  return fallbackIndex;
}
