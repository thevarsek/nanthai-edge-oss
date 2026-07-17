import { REQUEST_TIMEOUT_MS } from "./openrouter_constants";
import type { RetryConfig } from "./openrouter_types";

const MIN_TIMEOUT_MS = 1_000;

export interface NonStreamingDeadline {
  requestTimeoutMs: number;
  totalTimeoutMs?: number;
  startedAt: number;
}

function boundedTimeout(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.min(REQUEST_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, value))
    : fallback;
}

export function createNonStreamingDeadline(
  retryConfig: RetryConfig,
  startedAt: number,
): NonStreamingDeadline {
  const requestTimeoutMs = boundedTimeout(
    retryConfig.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
    REQUEST_TIMEOUT_MS,
  );
  const configuredTotal = retryConfig.totalTimeoutMs;
  const totalTimeoutMs = configuredTotal == null
    ? undefined
    : boundedTimeout(configuredTotal, REQUEST_TIMEOUT_MS);
  return { requestTimeoutMs, totalTimeoutMs, startedAt };
}

function remainingTotalMs(deadline: NonStreamingDeadline, now: number): number | undefined {
  return deadline.totalTimeoutMs == null
    ? undefined
    : deadline.totalTimeoutMs - Math.max(0, now - deadline.startedAt);
}

function totalTimeoutError(deadline: NonStreamingDeadline): Error {
  return new Error(
    `OpenRouter non-stream total timeout after ${deadline.totalTimeoutMs}ms.`,
  );
}

export function nextAttemptTimeoutMs(
  deadline: NonStreamingDeadline,
  now: number,
): number {
  const remaining = remainingTotalMs(deadline, now);
  if (remaining == null) return deadline.requestTimeoutMs;
  if (remaining <= 0) throw totalTimeoutError(deadline);
  return Math.max(1, Math.min(deadline.requestTimeoutMs, Math.floor(remaining)));
}

export function assertRetryDelayFits(
  deadline: NonStreamingDeadline,
  delayMs: number,
  now: number,
): void {
  const remaining = remainingTotalMs(deadline, now);
  if (remaining != null && delayMs >= remaining) throw totalTimeoutError(deadline);
}
