import { Image as ImageIcon, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ImageGenerationPlaceholder({
  compact = false,
  count = 1,
}: {
  compact?: boolean;
  count?: number;
}) {
  const { t } = useTranslation();
  const safeCount = Number.isFinite(count)
    ? Math.max(1, Math.min(10, Math.round(count)))
    : 1;
  const label = safeCount === 1
    ? t("generating_image")
    : t("generating_images", { count: safeCount });

  if (safeCount === 1) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label={label}
        className={compact ? "w-20" : "mt-2 w-60 max-w-full"}
      >
        <PlaceholderTile compact={compact} label={label} showLabel />
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className={compact ? "w-full" : "mt-2 w-72 max-w-full"}
    >
      <div className={`grid gap-1.5 ${safeCount <= 4 ? "grid-cols-2" : "grid-cols-3"}`}>
        {Array.from({ length: safeCount }, (_, index) => (
          <PlaceholderTile key={index} compact={compact} label={label} />
        ))}
      </div>
      <p className={compact ? "mt-1 text-center text-[9px] text-muted" : "mt-1.5 text-center text-xs text-muted"}>
        {label}
      </p>
    </div>
  );
}

function PlaceholderTile({
  compact,
  label,
  showLabel = false,
}: {
  compact: boolean;
  label: string;
  showLabel?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className={`relative overflow-hidden rounded-xl border border-border/30 bg-surface-2/60 ${
        compact ? "aspect-square min-w-0" : "aspect-square w-full"
      }`}
    >
      <div className="absolute inset-y-0 -left-24 w-24 bg-gradient-to-r from-transparent via-foreground/10 to-transparent motion-safe:animate-[edgeShimmer_1.8s_ease-in-out_infinite]" />
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/10 motion-safe:animate-pulse" />
      <div className="relative flex h-full flex-col items-center justify-center gap-2 px-2 text-center text-muted">
        <span className="relative inline-flex">
          <ImageIcon size={compact ? 20 : 28} aria-hidden="true" />
          <Sparkles
            size={compact ? 9 : 12}
            aria-hidden="true"
            className="absolute -right-2 -top-2 text-primary motion-safe:animate-pulse"
          />
        </span>
        {showLabel && (
          <span className={compact ? "text-[9px] leading-tight" : "text-xs"}>{label}</span>
        )}
      </div>
    </div>
  );
}
