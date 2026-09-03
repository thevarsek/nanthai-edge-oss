import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { ModelPicker } from "@/components/shared/ModelPicker";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";
import { useModelSummaries } from "@/hooks/useSharedData";
import { shortModelName } from "./ChatDefaultsSection.utils";

type GenerationKind = keyof NonNullable<ModelSummary["generationCapabilities"]>;

interface Props {
  generationKind: GenerationKind;
  preferenceKey: string;
  selectedModelId?: string;
  label: string;
  zdrEnabled: boolean;
  onChange: (patch: Record<string, unknown>) => void;
}

export function ChatDefaultsMediaModelPickerRow({
  generationKind,
  preferenceKey,
  selectedModelId = "",
  label,
  zdrEnabled,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const warningId = useId();
  const summaries = useModelSummaries({ includeGenerationModels: true }) as ModelSummary[] | undefined;
  const [showPicker, setShowPicker] = useState(false);
  const model = useMemo(
    () => summaries?.find((candidate) => candidate.modelId === selectedModelId),
    [selectedModelId, summaries],
  );
  const unavailableWithZdr = zdrEnabled
    && selectedModelId.length > 0
    && summaries !== undefined
    && model?.generationZdrCapabilities?.[generationKind] !== true;
  const modelName = model?.name ?? shortModelName(selectedModelId);

  return (
    <>
      <button
        type="button"
        aria-label={`${label}: ${modelName || t("model_default_placeholder")}`}
        aria-describedby={unavailableWithZdr ? warningId : undefined}
        data-testid={`generation-model-${generationKind}`}
        onClick={() => setShowPicker(true)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
      >
        <span className="flex-1 text-sm">{label}</span>
        <span className="min-w-0 text-right">
          <span className="block text-xs text-muted truncate max-w-[12rem]">{modelName}</span>
          {unavailableWithZdr && (
            <span id={warningId} className="block text-[10px] text-warning">{t("unavailable_with_zdr")}</span>
          )}
        </span>
        <ChevronRight size={14} className="text-muted flex-shrink-0" />
      </button>

      {showPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60"
          onClick={(event) => { if (event.target === event.currentTarget) setShowPicker(false); }}
        >
          <div className="w-full max-w-2xl bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ maxHeight: "80vh" }}>
            <ModelPicker
              selectedModelId={selectedModelId}
              onSelect={(modelId) => onChange({ [preferenceKey]: modelId })}
              onClose={() => setShowPicker(false)}
              title={t("choose_model")}
              generationKind={generationKind}
            />
          </div>
        </div>
      )}
    </>
  );
}
