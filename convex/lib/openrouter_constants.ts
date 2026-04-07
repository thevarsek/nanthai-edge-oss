export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
export const HTTP_REFERER = "https://nanthai.tech";
export const X_TITLE = "NanthAi:Edge";
export const REQUEST_TIMEOUT_MS = 180_000;
export const STREAM_REQUEST_TIMEOUT_MS = 900_000;
export const MAX_RATE_LIMIT_RETRIES = 3;
export const RATE_LIMIT_BACKOFF_MS = [1000, 2000, 4000];

export function retryAfterToMs(retryAfter: string | null): number | undefined {
  if (!retryAfter) return undefined;
  const trimmed = retryAfter.trim();
  if (!trimmed) return undefined;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.ceil(numeric * 1000);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isFinite(dateMs)) return undefined;
  const deltaMs = dateMs - Date.now();
  return deltaMs > 0 ? Math.ceil(deltaMs) : undefined;
}

export function rateLimitDelayMs(
  retryAfterHeader: string | null,
  attempt: number,
): number {
  const headerDelayMs = retryAfterToMs(retryAfterHeader);
  if (headerDelayMs !== undefined) {
    return headerDelayMs;
  }
  const fallback =
    RATE_LIMIT_BACKOFF_MS[Math.min(attempt, RATE_LIMIT_BACKOFF_MS.length - 1)] ??
    4000;
  return fallback;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
