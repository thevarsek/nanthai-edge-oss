import { Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MenuSelect, type MenuSelectOption } from "@/components/shared/MenuSelect";
import { SectionFooter, SectionHeader } from "./ChatDefaultsSection.helpers";
import { useOptimistic } from "./ChatDefaultsSection.utils";

const MODEL_DEFAULT = "__model_default__";

const COUNT_VALUES = Array.from({ length: 10 }, (_, index) => String(index + 1));
const ASPECT_RATIO_VALUES = ["1:1", "16:9", "9:16", "4:3", "3:4", "4:5", "5:4", "3:2", "2:3", "21:9"];
const RESOLUTION_VALUES = ["512", "1K", "2K", "4K"];
const QUALITY_VALUES = ["low", "medium", "high"];
const BACKGROUND_VALUES = ["auto", "transparent", "opaque"];
const OUTPUT_FORMAT_VALUES = ["png", "jpeg", "webp"];

export interface ImageGenerationPreferenceSource {
  defaultImageCount?: number | null;
  defaultImageAspectRatio?: string | null;
  defaultImageResolution?: string | null;
  defaultImageQuality?: string | null;
  defaultImageBackground?: string | null;
  defaultImageOutputFormat?: string | null;
  defaultImageOutputCompression?: number | null;
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
  onChange: (value: string) => void;
}

function ImageDefaultRow({ settingKey, label, value, options, onChange }: ImageDefaultRowProps) {
  return (
    <div data-testid={`image-default-${settingKey}`} className="flex items-center gap-6 px-4 py-3">
      <span className="text-sm w-40 shrink-0">{label}</span>
      <div className="flex-1 min-w-0 flex justify-end">
        <MenuSelect value={value} options={options} onChange={onChange} ariaLabel={label} />
      </div>
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
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid="image-default-compression" className="flex items-center gap-6 px-4 py-3">
      <label htmlFor="image-default-compression-input" className="text-sm w-40 shrink-0">
        {t("image_defaults_compression")}
      </label>
      <div className="flex-1 min-w-0 flex items-center justify-end gap-2">
        <input
          id="image-default-compression-input"
          type="number"
          min={0}
          max={100}
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
            if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 100) onChange(next);
          }}
          className="w-28 rounded-lg border border-border/50 bg-surface-3 px-2.5 py-1 text-right text-sm"
        />
        <span className="text-xs text-muted">%</span>
      </div>
    </div>
  );
}

export function ChatDefaultsImageGenerationSection({ prefs, onChange }: ImageDefaultsProps) {
  const { t } = useTranslation();
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

  return (
    <>
      <SectionHeader>
        <div className="flex items-center gap-1.5"><ImageIcon size={14} />{t("image_generation")}</div>
      </SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <ImageDefaultRow
          settingKey="count"
          label={t("image_defaults_count")}
          value={count}
          options={options(COUNT_VALUES, defaultLabel, (value) => value)}
          onChange={(value) => { setCount(value); onChange({ defaultImageCount: numberValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="aspect-ratio"
          label={t("image_defaults_aspect_ratio")}
          value={aspectRatio}
          options={options(ASPECT_RATIO_VALUES, defaultLabel, (value) => value)}
          onChange={(value) => { setAspectRatio(value); onChange({ defaultImageAspectRatio: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="resolution"
          label={t("image_defaults_resolution_size")}
          value={resolution}
          options={options(RESOLUTION_VALUES, defaultLabel, (value) => value)}
          onChange={(value) => { setResolution(value); onChange({ defaultImageResolution: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="quality"
          label={t("image_defaults_quality")}
          value={quality}
          options={options(QUALITY_VALUES, defaultLabel, (value) => t(value))}
          onChange={(value) => { setQuality(value); onChange({ defaultImageQuality: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="background"
          label={t("image_defaults_background")}
          value={background}
          options={options(BACKGROUND_VALUES, defaultLabel, (value) => t(`image_defaults_${value}`))}
          onChange={(value) => { setBackground(value); onChange({ defaultImageBackground: nullableValue(value) }); }}
        />
        <ImageDefaultRow
          settingKey="output-format"
          label={t("image_defaults_output_format")}
          value={outputFormat}
          options={options(OUTPUT_FORMAT_VALUES, defaultLabel, (value) => value.toUpperCase())}
          onChange={(value) => { setOutputFormat(value); onChange({ defaultImageOutputFormat: nullableValue(value) }); }}
        />
        <CompressionRow
          value={compression}
          onChange={(value) => { setCompression(value); onChange({ defaultImageOutputCompression: numberValue(value) }); }}
        />
      </div>
      <SectionFooter>{t("image_defaults_adaptation_hint")}</SectionFooter>
    </>
  );
}
