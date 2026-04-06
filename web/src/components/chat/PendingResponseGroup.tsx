import type { Participant } from "@/hooks/useChat";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { ProviderLogo } from "@/components/shared/ProviderLogo";

function getParticipantLabel(participant: Participant): string {
  return participant.personaName ?? participant.modelId.split("/").pop() ?? participant.modelId;
}

function PendingResponseRow({ participant }: { participant: Participant }) {
  const label = getParticipantLabel(participant);
  const hasPersonaAvatar = !!(participant.personaName || participant.personaEmoji || participant.personaAvatarImageUrl);

  return (
    <div className="flex gap-3 group">
      <div className="shrink-0 mt-1">
        {hasPersonaAvatar ? (
          <PersonaAvatar
            personaId={participant.personaId ?? undefined}
            personaName={participant.personaName ?? undefined}
            personaEmoji={participant.personaEmoji ?? undefined}
            personaAvatarImageUrl={participant.personaAvatarImageUrl ?? undefined}
            className="w-7 h-7"
            emojiClass="text-sm"
            initialClass="text-[10px]"
            iconSize={12}
          />
        ) : (
          <ProviderLogo modelId={participant.modelId} size={28} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <p className="text-xs text-muted">{label}</p>
        </div>
        <span
          className="inline-block text-base leading-6 font-medium tracking-[0.18em] animate-pulse"
          style={{ color: "hsl(var(--nanth-foreground) / 0.72)" }}
        >
          ...
        </span>
      </div>
    </div>
  );
}

export function PendingResponseGroup({ participants }: { participants: Participant[] }) {
  if (participants.length <= 1) {
    const participant = participants[0];
    if (!participant) return null;
    return <PendingResponseRow participant={participant} />;
  }

  return (
    <div className="space-y-0">
      <div className="rounded-xl bg-surface-2/30 border border-border/20 py-2 px-2">
        {participants.map((participant, index) => (
          <div key={`${participant.personaId ?? participant.modelId}-${index}`}>
            {index > 0 && (
              <div className="ml-11 my-1.5 border-t border-border/20" />
            )}
            <PendingResponseRow participant={participant} />
          </div>
        ))}
      </div>
    </div>
  );
}
