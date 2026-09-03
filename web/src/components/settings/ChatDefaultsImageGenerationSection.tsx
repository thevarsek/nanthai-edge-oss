import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MenuSelect, type MenuSelectOption } from "@/components/shared/MenuSelect";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";
import { exactImageCounts, uniqueMediaValues } from "@/components/shared/ModelMediaCapabilities.utils";
import { useModelSummaries } from "@/hooks/useSharedData";
import { SectionFooter, SectionHeader } from "./ChatDefaultsSection.helpers";
import { useOptimistic } from "./ChatDefaultsSection.utils";
import { ChatDefaultsMediaModelPickerRow } from "./ChatDefaultsMediaModelPickerRow";

const MODEL_DEFAULT = "__model_default__";

export interface ImageGenerationPreferenceSource {
  defaultImageGenerationModelId?: string;
  defaultImageCount?: number | null;
  defaultImageAspectRatio?: string | null;
  defaultImageResolution?: string | null;
  defaultImageQuality?: string | null;
  defaultImageBackground?: string | null;
  defaultImageOutputFormat?: string | null;
  defaultImageOutputCompression?: number | null;
  zdrEnabled?: boolean;
}

interface ImageDefaultsProps {
  prefs?: ImageGenerationPreferenceSource | null;
  onChange: (patch: Record<string, unknown>) => void;
}

interface ImageDefaultRowProps {
  settingKey: string;
  label: string;
  value: string;
  options: MenuSelectOption[];
  supported: boolean;
  onChange: (value: string) => void;
}

function ImageDefaultRow({ settingKey, label, value, options, supported, onChange }: ImageDefaultRowProps) {
  const { t } = useTranslation();
  return (
    <div data-testid={`image-default-${settingKey}`} className={`px-4 py-3 ${supported ? "" : "opacity-50"}`}>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-6">
        <span className="w-full text-sm sm:w-40 sm:shrink-0">{label}</span>
        <div className="flex min-w-0 flex-1 justify-start sm:justify-end">
          <MenuSelect disabled={!supported} value={value} options={options} onChange={onChange} ariaLabel={label} />
        </div>
      </div>
      {!supported && <p className="text-[10px] text-muted mt-1">{t("media_not_supported")}</p>}
    </div>
  );
}

function options(values: string[], defaultLabel: string, label: (value: string) => string): MenuSelectOption[] {
  return [
    { value: MODEL_DEFAULT, label: defaultLabel },
    ...values.map((value) => ({ value, label: label(value) })),
  ];
}

function nullableValue(value: string): string | null {
  return value === MODEL_DEFAULT ? null : value;
}

function numberValue(value: string): number | null {
  return value === MODEL_DEFAULT ? null : Number(value);
}

function CompressionRow({
  value,
  supported,
  min,
  max,
  onChange,
}: {
  value: string;
  supported: boolean;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="image-default-compression" className={`px-4 py-3 ${supported ? "" : "opacity-50"}`}>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-6">
        <label htmlFor="image-default-compression-input" className="w-full text-sm sm:w-40 sm:shrink-0">
          {t("image_defaults_compression")}
        </label>
        <div className="flex min-w-0 flex-1 items-center justify-start gap-2 sm:justify-end">
          <input
          id="image-default-compression-input" type="number" disabled={!supported}
          min={min} max={max}
          step={1}
          value={value === MODEL_DEFAULT ? "" : value}
          placeholder={t("image_defaults_model_default")}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "") {
              onChange(MODEL_DEFAULT);
              return;
            }
            const parsed = Number(next);
            if (Number.isInteger(parsed) && parsed >= min && parsed <= max) onChange(next);
          }}
          className="w-full rounded-lg border border-border/50 bg-surface-3 px-2.5 py-1 text-right text-sm sm:w-28"
        />
          <span className="text-xs text-muted">%</span>
        </div>
      </div>
      {!supported && <p className="text-[10px] text-muted mt-1">{t("media_not_supported")}</p>}
    </div>
  );
}

export function ChatDefaultsImageGenerationSection({ prefs, onChange }: ImageDefaultsProps) {
  const { t } = useTranslation();
  const summaries = useModelSummaries({ includeGenerationModels: true }) as ModelSummary[] | undefined;
  const selectedModel = summaries?.find((model) => model.modelId === prefs?.defaultImageGenerationModelId);
  const capabilities = selectedModel?.mediaCapabilities?.image;
  const defaultLabel = t("image_defaults_model_default");
  const [count, setCount] = useOptimistic(prefs?.defaultImageCount == null ? MODEL_DEFAULT : String(prefs.defaultImageCount));
  const [aspectRatio, setAspectRatio] = useOptimistic(prefs?.defaultImageAspectRatio ?? MODEL_DEFAULT);
  const [resolution, setResolution] = useOptimistic(prefs?.defaultImageResolution ?? MODEL_DEFAULT);
  const [quality, setQuality] = useOptimistic(prefs?.defaultImageQuality ?? MODEL_DEFAULT);
  const [background, setBackground] = useOptimistic(prefs?.defaultImageBackground ?? MODEL_DEFAULT);
  const [outputFormat, setOutputFormat] = useOptimistic(prefs?.defaultImageOutputFormat ?? MODEL_DEFAULT);
  const [compression, setCompression] = useOptimistic(
    prefs?.defaultImageOutputCompression == null ? MODEL_DEFAULT : String(prefs.defaultImageOutputCompression),
  );
  const countValues = capabilities?.counts?.length
    ? exactImageCounts(capabilities.counts).map(String)
    : capabilities?.countMin != null && capabilities?.countMax != null
      ? Array.from(
          { length: Math.max(0, Math.floor(capabilities.countMax) - Math.ceil(capabilities.countMin) + 1) },
          (_, index) => String(Math.ceil(capabilities.countMin!) + index),
        )
      : [];
  const resolutionValues = uniqueMediaValues([
    ...(capabilities?.resolutions ?? []),
    ...(capabilities?.sizes ?? []),
  ]);

  return (
    <>
      <SectionHeader>
        <div className="flex items-center gap-1.5"><ImageIcon size={14} />{t("image_generation")}</div>
      </SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <ChatDefaultsMediaModelPickerRow
          generationKind="image"
          preferenceKey="defaultImageGenerationModelId"
          selectedModelId={prefs?.defaultImageGenerationModelId}
          label={t("default_model")}
          zdrEnabled={prefs?.zdrEnabled === true}
          onChange={onChange}
        />
        <ImageDefaultRow
          settingKey="count"
          label={t("image_defaults_count")}
          value={count}
          options={options(countValues, defaultLabel, (value) => value)}
          supported={countValues.length > 0}
          onChange={(value) => { setCount(value); onChange({ defaultImageCount: numberValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="aspect-ratio"
          label={t("image_defaults_aspect_ratio")}
          value={aspectRatio}
          options={options(capabilities?.aspectRatios ?? [], defaultLabel, (value) => value)}
          supported={(capabilities?.aspectRatios.length ?? 0) > 0}
          onChange={(value) => { setAspectRatio(value); onChange({ defaultImageAspectRatio: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="resolution"
          label={t("image_defaults_resolution_size")}
          value={resolution}
          options={options(resolutionValues, defaultLabel, (value) => value)}
          supported={resolutionValues.length > 0}
          onChange={(value) => { setResolution(value); onChange({ defaultImageResolution: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="quality"
          label={t("image_defaults_quality")}
          value={quality}
          options={options(capabilities?.qualities ?? [], defaultLabel, (value) => t(value))}
          supported={(capabilities?.qualities.length ?? 0) > 0}
          onChange={(value) => { setQuality(value); onChange({ defaultImageQuality: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="background"
          label={t("image_defaults_background")}
          value={background}
          options={options(capabilities?.backgrounds ?? [], defaultLabel, (value) => t(`image_defaults_${value}`))}
          supported={(capabilities?.backgrounds.length ?? 0) > 0}
          onChange={(value) => { setBackground(value); onChange({ defaultImageBackground: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="output-format"
          label={t("image_defaults_output_format")}
          value={outputFormat}
          options={options(capabilities?.outputFormats ?? [], defaultLabel, (value) => value.toUpperCase())}
          supported={(capabilities?.outputFormats.length ?? 0) > 0}
          onChange={(value) => { setOutputFormat(value); onChange({ defaultImageOutputFormat: nullableValue(value) }); }}
        />
        <CompressionRow
          value={compression}
          supported={capabilities?.supportsOutputCompression === true}
          min={capabilities?.outputCompressionMin ?? 0}
          max={capabilities?.outputCompressionMax ?? 100}
          onChange={(value) => { setCompression(value); onChange({ defaultImageOutputCompression: numberValue(value) }); }}
        />
      </div>
      <SectionFooter>
        {t("image_generation_model_footer")} {t("image_defaults_adaptation_hint")}
      </SectionFooter>
    </>
  );
}
