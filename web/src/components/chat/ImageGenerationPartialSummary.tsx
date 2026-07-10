import { useTranslation } from "react-i18next";

export interface ImageGenerationResultSummary {
  requestedCount: number;
  generatedCount: number;
  failedCount: number;
}

export function ImageGenerationPartialSummary({
  result,
  compact = false,
}: {
  result?: ImageGenerationResultSummary;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (!result || result.failedCount <= 0) return null;

  return (
    <p role="status" className={`${compact ? "text-[9px]" : "text-xs"} mt-1 text-amber-500`}>
      {t("image_generation_partial_success", {
        generated: result.generatedCount,
        requested: result.requestedCount,
      })}
    </p>
  );
}
