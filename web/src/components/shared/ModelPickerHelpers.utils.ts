export function formatPrice(per1M?: number): string {
  if (per1M == null) return "—";
  if (per1M === 0) return "$0.00/M";
  if (per1M < 0.01) return `$${per1M.toFixed(4)}/M`;
  if (per1M < 1) return `$${per1M.toFixed(3)}/M`;
  return `$${per1M.toFixed(2)}/M`;
}

/** Format video pricing — per-second or per-token, depending on what's available. */
export function formatVideoPrice(price?: number, unit?: string): string {
  if (price == null) return "—";
  if (price === 0) return "$0.00";
  if (price < 0.0001) return `$${price.toExponential(1)}/${unit ?? "unit"}`;
  if (price < 0.01) return `$${price.toFixed(6)}/${unit ?? "unit"}`;
  if (price < 1) return `$${price.toFixed(4)}/${unit ?? "unit"}`;
  return `$${price.toFixed(2)}/${unit ?? "unit"}`;
}
