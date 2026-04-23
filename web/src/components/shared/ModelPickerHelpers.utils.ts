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

/**
 * Format image-gen pricing as dollars-per-megapixel.
 *
 * OpenRouter's `image_output` SKU is dollars-per-image-token, where
 * 1 megapixel = 4096 image tokens across providers (BFL, Google, OpenAI).
 * This matches how providers advertise pricing (e.g. FLUX.2 = $0.06/MP,
 * Gemini 3 Pro Image ~ $0.49/MP). Displaying per-token would be opaque
 * (e.g. `$0.0000146/tok`); per-megapixel is the unit users recognize.
 */
const IMAGE_TOKENS_PER_MEGAPIXEL = 4096;

export function formatImagePrice(perImageToken?: number): string {
  if (perImageToken == null) return "—";
  const perMP = perImageToken * IMAGE_TOKENS_PER_MEGAPIXEL;
  if (perMP === 0) return "$0.00/MP";
  if (perMP < 0.01) return `$${perMP.toFixed(4)}/MP`;
  if (perMP < 1) return `$${perMP.toFixed(3)}/MP`;
  return `$${perMP.toFixed(2)}/MP`;
}

/**
 * Returns a compact price label for a model picker list row, or null when
 * the model is free (the Free capability chip already communicates that) or
 * has no pricing data. Mirrors iOS `ModelCompatibilitySummaryView` and
 * Android `listRowPriceLabel` so the three clients surface cost identically:
 *
 *   - Video models: per-second when available, else per-1M video tokens
 *   - Image-gen models: per-megapixel (4096 image tokens per MP)
 *   - Text models: combined prompt+completion per-1M tokens
 */
export function listRowPriceLabel(model: {
  isFree?: boolean;
  modelId: string;
  supportsVideo?: boolean;
  videoPricing?: { perVideoSecond?: number; perVideoToken?: number };
  supportsImages?: boolean;
  imagePricing?: { perImageOutput?: number };
  inputPricePer1M?: number;
  outputPricePer1M?: number;
}): string | null {
  if (model.isFree ?? model.modelId.endsWith(":free")) return null;
  if (model.supportsVideo && model.videoPricing) {
    if (model.videoPricing.perVideoSecond != null && model.videoPricing.perVideoSecond > 0) {
      return formatVideoPrice(model.videoPricing.perVideoSecond, "sec");
    }
    if (model.videoPricing.perVideoToken != null && model.videoPricing.perVideoToken > 0) {
      return formatVideoPrice(model.videoPricing.perVideoToken, "tok");
    }
  }
  if (model.supportsImages && model.imagePricing?.perImageOutput != null && model.imagePricing.perImageOutput > 0) {
    return formatImagePrice(model.imagePricing.perImageOutput);
  }
  const combined = (model.inputPricePer1M ?? 0) + (model.outputPricePer1M ?? 0);
  return combined > 0 ? formatPrice(combined) : null;
}
