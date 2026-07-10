import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  exactImageCounts,
  joinedMediaValues,
  uniqueMediaValues,
  type ImageMediaCapabilities,
  type ModelMediaCapabilities,
  type VideoMediaCapabilities,
} from "./ModelMediaCapabilities.utils";

interface CapabilityRow {
  label: string;
  value: string;
}

function imageRows(t: TFunction, image: ImageMediaCapabilities): CapabilityRow[] {
  const rows: CapabilityRow[] = [];
  const exactCounts = exactImageCounts(image.counts);
  if (exactCounts.length > 0) {
    rows.push({
      label: t("media_images_per_request"),
      value: exactCounts.join(", "),
    });
  } else if (image.countMin != null || image.countMax != null) {
    const min = image.countMin ?? 1;
    const max = image.countMax ?? min;
    rows.push({
      label: t("media_images_per_request"),
      value: min === max ? String(max) : `${min}–${max}`,
    });
  }
  if (image.maxInputReferences != null && image.maxInputReferences > 0) {
    rows.push({
      label: t("media_image_references"),
      value: t("media_up_to_count", { count: image.maxInputReferences }),
    });
  }
  if (image.aspectRatios.length > 0) {
    rows.push({ label: t("media_aspect_ratios"), value: joinedMediaValues(t, image.aspectRatios) });
  }
  const resolutionValues = uniqueMediaValues([...image.resolutions, ...image.sizes]);
  if (resolutionValues.length > 0) {
    rows.push({ label: t("media_resolutions_sizes"), value: joinedMediaValues(t, resolutionValues) });
  }
  if (image.qualities.length > 0) {
    rows.push({ label: t("image_defaults_quality"), value: joinedMediaValues(t, image.qualities) });
  }
  if (image.backgrounds.length > 0) {
    rows.push({ label: t("image_defaults_background"), value: joinedMediaValues(t, image.backgrounds) });
  }
  if (image.outputFormats.length > 0) {
    rows.push({ label: t("image_defaults_output_format"), value: joinedMediaValues(t, image.outputFormats) });
  }
  rows.push({
    label: t("media_streaming"),
    value: t(image.supportsStreaming ? "media_supported" : "media_not_supported"),
  });
  return rows;
}

function videoRows(t: TFunction, video: VideoMediaCapabilities): CapabilityRow[] {
  const rows: CapabilityRow[] = [];
  if (video.resolutions.length > 0) {
    rows.push({ label: t("video_config_resolution"), value: joinedMediaValues(t, video.resolutions) });
  }
  if (video.aspectRatios.length > 0) {
    rows.push({ label: t("video_config_aspect_ratio"), value: joinedMediaValues(t, video.aspectRatios) });
  }
  if (video.durations.length > 0) {
    rows.push({
      label: t("video_config_duration"),
      value: [...new Set(video.durations)].sort((a, b) => a - b).map((value) => `${value}s`).join(", "),
    });
  }
  if (video.frameImages.length > 0) {
    rows.push({ label: t("media_frame_inputs"), value: joinedMediaValues(t, video.frameImages) });
  }
  rows.push({
    label: t("media_audio_generation"),
    value: t(video.supportsAudio ? "media_supported" : "media_not_supported"),
  });
  rows.push({
    label: t("media_seed_control"),
    value: t(video.supportsSeed ? "media_supported" : "media_not_supported"),
  });
  return rows;
}

function CapabilityRows({ rows }: { rows: CapabilityRow[] }) {
  return (
    <div className="rounded-xl bg-surface-2 divide-y divide-border/50">
      {rows.map((row) => (
        <div key={row.label} className="flex items-start justify-between gap-4 px-3 py-2">
          <span className="text-xs text-muted">{row.label}</span>
          <span className="text-xs text-right break-words">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function ModelMediaCapabilitiesSection({
  capabilities,
}: {
  capabilities?: ModelMediaCapabilities;
}) {
  const { t } = useTranslation();
  if (!capabilities?.image && !capabilities?.video) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wide">
        {t("media_generation_options")}
      </h3>
      {capabilities.image ? <CapabilityRows rows={imageRows(t, capabilities.image)} /> : null}
      {capabilities.video ? <CapabilityRows rows={videoRows(t, capabilities.video)} /> : null}
    </div>
  );
}
