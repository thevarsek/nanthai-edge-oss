export function formatPrice(per1M?: number): string {
  if (per1M == null) return "—";
  if (per1M === 0) return "$0.00/M";
  if (per1M < 0.01) return `$${per1M.toFixed(4)}/M`;
  if (per1M < 1) return `$${per1M.toFixed(3)}/M`;
  return `$${per1M.toFixed(2)}/M`;
}
