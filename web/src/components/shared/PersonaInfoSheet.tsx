import { X, Brain, Wrench, Gift, Eye } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useModelSummaries } from "@/hooks/useSharedData";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import type { PersonaItem } from "@/components/chat/ChatParticipantPicker.helpers";

export function PersonaInfoSheet({
  persona,
  onClose,
}: {
  persona: PersonaItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const modelSummaries = useModelSummaries();
  const model = modelSummaries?.find((item) => item.modelId === persona.modelId);
  const hasOverrides =
    persona.temperature != null ||
    persona.maxTokens != null ||
    persona.includeReasoning != null ||
    persona.reasoningEffort != null;

  return (
    <div className="flex flex-col max-h-[85vh] bg-background">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h2 className="text-base font-semibold">{t("persona_info")}</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-muted hover:text-foreground transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        <div className="flex items-center gap-3">
          <PersonaAvatar
            personaId={persona._id}
            personaName={persona.displayName}
            personaEmoji={persona.avatarEmoji}
            personaAvatarImageUrl={persona.avatarImageUrl}
            className="w-14 h-14"
            emojiClass="text-2xl"
            initialClass="text-lg"
            iconSize={22}
          />
          <div className="min-w-0">
            <p className="text-base font-semibold truncate">{persona.displayName}</p>
            {persona.personaDescription && (
              <p className="text-sm text-muted mt-1">{persona.personaDescription}</p>
            )}
          </div>
        </div>

        {persona.systemPrompt && (
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wide">System Prompt</h3>
            <div className="rounded-xl bg-surface-2 border border-border/40 p-3 text-sm whitespace-pre-wrap leading-relaxed">
              {persona.systemPrompt}
            </div>
          </div>
        )}

        <div className="space-y-1">
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide">{t("assigned_model")}</h3>
          <div className="rounded-xl bg-surface-2 border border-border/40 p-3 space-y-2">
            <div>
              <p className="text-sm font-medium">{model?.name ?? persona.modelId ?? t("model")}</p>
              {persona.modelId && (
                <p className="text-xs text-muted font-mono mt-0.5">{persona.modelId}</p>
              )}
            </div>
            {model && (
              <div className="flex flex-wrap gap-2 text-[11px] text-muted">
                {model.supportsImages && (
                  <span className="inline-flex items-center gap-1"><Eye size={12} /> Vision</span>
                )}
                {model.supportsTools && (
                  <span className="inline-flex items-center gap-1"><Wrench size={12} /> Tools</span>
                )}
                {model.hasReasoning && (
                  <span className="inline-flex items-center gap-1"><Brain size={12} /> Reasoning</span>
                )}
                {(model.inputPricePer1M ?? 0) === 0 && (model.outputPricePer1M ?? 0) === 0 && (
                  <span className="inline-flex items-center gap-1"><Gift size={12} /> Free</span>
                )}
              </div>
            )}
          </div>
        </div>

        {hasOverrides && (
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wide">Parameter Overrides</h3>
            <div className="rounded-xl bg-surface-2 border border-border/40 divide-y divide-border/30">
              {persona.temperature != null && (
                <InfoRow label={t("temperature")} value={persona.temperature.toFixed(1)} />
              )}
              {persona.maxTokens != null && (
                <InfoRow label={t("max_tokens")} value={String(persona.maxTokens)} />
              )}
              {persona.includeReasoning != null && (
                <InfoRow label={t("reasoning")} value={persona.includeReasoning ? "On" : "Off"} />
              )}
              {persona.reasoningEffort && (
                <InfoRow label={t("reasoning_effort")} value={persona.reasoningEffort} />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
