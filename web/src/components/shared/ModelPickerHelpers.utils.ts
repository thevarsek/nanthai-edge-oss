import type { TFunction } from "i18next";

export function guidanceLabelText(t: TFunction, label: string): string {
  const labelMap: Record<string, string> = {
    "recommended.best": t("best_overall"),
    "recommended.top": t("top_pick"),
    "coding.best": t("best_for_coding"),
    "coding.top": t("great_for_coding"),
    "research.best": t("best_for_research"),
    "research.top": t("great_for_research"),
    "fast.best": t("fast_replies"),
    "fast.top": t("fast_replies"),
    "value.best": t("best_value"),
    "value.top": t("great_value"),
    "image.best": t("top_image_model"),
    "image.top": t("top_image_model"),
  };
  return labelMap[label] ?? label;
}

export function formatPrice(per1M?: number): string {
  if (per1M == null) return "—";
  if (per1M === 0) return "$0.00/M";
  if (per1M < 0.01) return `$${per1M.toFixed(4)}/M`;
  if (per1M < 1) return `$${per1M.toFixed(3)}/M`;
  return `$${per1M.toFixed(2)}/M`;
}

/**
 * Format video pricing — per-second or per-token, depending on what's
 * available. Per-token values from OpenRouter are raw per-token dollars
 * (e.g. 0.0000024) which are unreadable; we scale to per-1M tokens so
 * the number matches the mental model used for text pricing.
 */
export function formatVideoPrice(price?: number, unit?: string): string {
  if (price == null) return "—";
  if (price === 0) return "$0.00";
  if (unit === "tok") {
    // Treat video-token prices like text pricing: scale to per-1M tokens.
    return formatPrice(price * 1_000_000).replace("/M", "/M tok");
  }
  if (price < 0.0001) return `$${price.toExponential(1)}/${unit ?? "unit"}`;
  if (price < 0.01) return `$${price.toFixed(6)}/${unit ?? "unit"}`;
  if (price < 1) return `$${price.toFixed(4)}/${unit ?? "unit"}`;
  return `$${price.toFixed(2)}/${unit ?? "unit"}`;
}

const IMAGE_TOKENS_PER_MEGAPIXEL = 4096;

export interface ImagePricing {
  /** Direct dollars per generated image from the dedicated Image API. */
  perImage?: number;
  /** Direct dollars per megapixel from the dedicated Image API. */
  perMegapixel?: number;
  /** Legacy dollars per image input token. */
  perImageToken?: number;
  /** Legacy dollars per image output token. */
  perImageOutput?: number;
}

export interface ResolvedImagePrice {
  amount: number;
  unit: "image" | "megapixel";
}

/** Prefer direct Image API units, falling back to 4096 image tokens per MP. */
export function resolveImagePrice(pricing?: ImagePricing): ResolvedImagePrice | null {
  if (pricing?.perImage != null && pricing.perImage > 0) {
    return { amount: pricing.perImage, unit: "image" };
  }
  if (pricing?.perMegapixel != null && pricing.perMegapixel > 0) {
    return { amount: pricing.perMegapixel, unit: "megapixel" };
  }
  const tokenPrice = pricing?.perImageOutput != null && pricing.perImageOutput > 0
    ? pricing.perImageOutput
    : pricing?.perImageToken != null && pricing.perImageToken > 0
      ? pricing.perImageToken
      : null;
  return tokenPrice == null
    ? null
    : { amount: tokenPrice * IMAGE_TOKENS_PER_MEGAPIXEL, unit: "megapixel" };
}

export function formatResolvedImagePrice(price?: ResolvedImagePrice | null): string {
  if (price == null) return "—";
  const suffix = price.unit === "image" ? "image" : "MP";
  if (price.amount === 0) return `$0.00/${suffix}`;
  if (price.amount < 0.01) return `$${price.amount.toFixed(4)}/${suffix}`;
  if (price.amount < 1) return `$${price.amount.toFixed(3)}/${suffix}`;
  return `$${price.amount.toFixed(2)}/${suffix}`;
}

/** Format a legacy token-only image rate as dollars per megapixel. */
export function formatImagePrice(perImageToken?: number): string {
  if (perImageToken == null) return "—";
  return formatResolvedImagePrice({
    amount: perImageToken * IMAGE_TOKENS_PER_MEGAPIXEL,
    unit: "megapixel",
  });
}

/**
 * Returns a compact price label for a model picker list row, or null when
 * the model is free (the Free capability chip already communicates that) or
 * has no pricing data. Mirrors iOS `ModelCompatibilitySummaryView` and
 * Android `listRowPriceLabel` so the three clients surface cost identically:
 *
 *   - Video models: per-second when available, else per-1M video tokens
 *   - Image-gen models: direct per-image, direct per-MP, then token × 4096
 *   - Text models: combined prompt+completion per-1M tokens
 */
export function listRowPriceLabel(model: {
  isFree?: boolean;
  modelId: string;
  supportsVideo?: boolean;
  videoPricing?: {
    perVideoSecond?: number;
    perVideoSecond1080p?: number;
    perVideoToken?: number;
    perVideoTokenNoAudio?: number;
  };
  supportsImages?: boolean;
  imagePricing?: ImagePricing;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
}): string | null {
  if (model.isFree ?? model.modelId.endsWith(":free")) return null;
  if (model.supportsVideo && model.videoPricing) {
    if (model.videoPricing.perVideoSecond != null && model.videoPricing.perVideoSecond > 0) {
      return formatVideoPrice(model.videoPricing.perVideoSecond, "sec");
    }
    if (model.videoPricing.perVideoSecond1080p != null && model.videoPricing.perVideoSecond1080p > 0) {
      return formatVideoPrice(model.videoPricing.perVideoSecond1080p, "sec");
    }
    if (model.videoPricing.perVideoToken != null && model.videoPricing.perVideoToken > 0) {
      return formatVideoPrice(model.videoPricing.perVideoToken, "tok");
    }
    if (model.videoPricing.perVideoTokenNoAudio != null && model.videoPricing.perVideoTokenNoAudio > 0) {
      return formatVideoPrice(model.videoPricing.perVideoTokenNoAudio, "tok");
    }
  }
  const imagePrice = resolveImagePrice(model.imagePricing);
  if (model.supportsImages && imagePrice) {
    return formatResolvedImagePrice(imagePrice);
  }
  const combined = (model.inputPricePer1M ?? 0) + (model.outputPricePer1M ?? 0);
  return combined > 0 ? formatPrice(combined) : null;
}

export type WizardTask = "everyday" | "coding" | "research" | "writing" | "translation";
export type WizardPriority = "quality" | "fastest" | "value";

const wizardTaskCategories: Record<WizardTask, string> = {
  everyday: "trivia",
  coding: "programming",
  research: "academia",
  writing: "marketing",
  translation: "translation",
};

export function wizardScore(
  model: {
    derivedGuidance?: { scores?: Record<string, number> };
    openRouterUseCases?: { category: string; returnedRank?: number }[];
  },
  task: WizardTask,
  priority: WizardPriority,
): number {
  const scores = model.derivedGuidance?.scores;
  if (!scores) return 0;

  const useCaseRank = model.openRouterUseCases?.find(
    (useCase) => useCase.category === wizardTaskCategories[task],
  )?.returnedRank;
  const useCaseScore = useCaseRank != null && useCaseRank > 0
    ? Math.max(0, 1 - ((useCaseRank - 1) / 100))
    : undefined;
  const domainKey = task === "coding" ? "coding" : task === "research" ? "research" : "recommended";
  const priorityKey = priority === "fastest" ? "fast" : priority === "value" ? "value" : domainKey;

  if (task !== "coding" && task !== "research" && useCaseScore != null) {
    if (priority === "quality") {
      return useCaseScore * 0.7 + (scores.recommended ?? 0) * 0.3;
    }
    return useCaseScore * 0.5 + (scores[priorityKey] ?? 0) * 0.3 + (scores.recommended ?? 0) * 0.2;
  }

  if ((task === "coding" || task === "research") && priority !== "quality") {
    return (
      (scores[priorityKey] ?? 0) * 0.6 +
      (scores[domainKey] ?? scores.recommended ?? 0) * 0.3 +
      (useCaseScore ?? 0) * 0.1
    );
  }

  if (useCaseScore != null) {
    return useCaseScore * 0.4 + (scores[domainKey] ?? scores.recommended ?? 0) * 0.6;
  }
  return scores[priorityKey] ?? scores.recommended ?? 0;
}
