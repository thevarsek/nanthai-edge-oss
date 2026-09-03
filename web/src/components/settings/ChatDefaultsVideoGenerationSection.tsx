import { Video } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { Toggle } from "@/components/shared/Toggle";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";
import { useModelSummaries } from "@/hooks/useSharedData";
import { SectionFooter, SectionHeader } from "./ChatDefaultsSection.helpers";
import { useOptimistic } from "./ChatDefaultsSection.utils";
import { ChatDefaultsMediaModelPickerRow } from "./ChatDefaultsMediaModelPickerRow";

interface Preferences {
  defaultVideoGenerationModelId?: string;
  defaultVideoAspectRatio?: string;
  defaultVideoDuration?: number;
  defaultVideoResolution?: string;
  defaultVideoGenerateAudio?: boolean;
  zdrEnabled?: boolean;
}

interface Props {
  prefs?: Preferences | null;
  onChange: (patch: Record<string, unknown>) => void;
}

function OptionRow({ label, value, values, onChange }: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const supported = values.length > 0;
  return (
    <div className={`px-4 py-3 ${supported ? "" : "opacity-50"}`}>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <label className="w-full text-sm sm:w-40 sm:shrink-0">{label}</label>
        <MenuSelect disabled={!supported} value={value} options={values.map((option) => ({ value: option, label: option }))} ariaLabel={label} onChange={onChange} />
      </div>
      {!supported && <p className="text-[10px] text-muted mt-1">{t("media_not_supported")}</p>}
    </div>
  );
}

export function ChatDefaultsVideoGenerationSection({ prefs, onChange }: Props) {
  const { t } = useTranslation();
  const summaries = useModelSummaries({ includeGenerationModels: true }) as ModelSummary[] | undefined;
  const selectedModel = summaries?.find((model) => model.modelId === prefs?.defaultVideoGenerationModelId);
  const capabilities = selectedModel?.mediaCapabilities?.video;
  const [aspectRatio, setAspectRatio] = useOptimistic(prefs?.defaultVideoAspectRatio ?? "16:9");
  const [duration, setDuration] = useOptimistic(prefs?.defaultVideoDuration ?? 5);
  const [resolution, setResolution] = useOptimistic(prefs?.defaultVideoResolution ?? "720p");
  const [generateAudio, setGenerateAudio] = useOptimistic(prefs?.defaultVideoGenerateAudio ?? true);

  return (
    <>
      <SectionHeader><div className="flex items-center gap-1.5"><Video size={14} />{t("video_generation")}</div></SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <ChatDefaultsMediaModelPickerRow generationKind="video" preferenceKey="defaultVideoGenerationModelId" selectedModelId={prefs?.defaultVideoGenerationModelId} label={t("default_model")} zdrEnabled={prefs?.zdrEnabled === true} onChange={onChange} />
        <OptionRow label={t("video_config_aspect_ratio")} value={aspectRatio} values={capabilities?.aspectRatios ?? []} onChange={(value) => { setAspectRatio(value); onChange({ defaultVideoAspectRatio: value }); }} />
        <OptionRow label={t("video_config_resolution")} value={resolution} values={capabilities?.resolutions ?? []} onChange={(value) => { setResolution(value); onChange({ defaultVideoResolution: value }); }} />
        <OptionRow label={t("video_config_duration")} value={String(duration)} values={(capabilities?.durations ?? []).map(String)} onChange={(value) => { const next = Number(value); setDuration(next); onChange({ defaultVideoDuration: next }); }} />
        <div className={`px-4 py-3 ${capabilities?.supportsAudio ? "" : "opacity-50"}`}>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <label className="w-full text-sm sm:w-40 sm:shrink-0">{t("video_config_audio")}</label>
            <Toggle disabled={!capabilities?.supportsAudio} checked={generateAudio} onChange={(value) => { setGenerateAudio(value); onChange({ defaultVideoGenerateAudio: value }); }} />
          </div>
          {!capabilities?.supportsAudio && <p className="text-[10px] text-muted mt-1">{t("media_not_supported")}</p>}
        </div>
      </div>
      <SectionFooter>{t("video_generation_model_footer")} {t("video_config_snap_hint")}</SectionFooter>
    </>
  );
}
