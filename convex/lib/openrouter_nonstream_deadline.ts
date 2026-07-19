import {
  OPENROUTER_ACTION_BUDGET_MS,
  REQUEST_TIMEOUT_MS,
} from "./openrouter_constants";
import type { RetryConfig } from "./openrouter_types";

const MIN_TIMEOUT_MS = 1_000;

export interface NonStreamingDeadline {
  requestTimeoutMs: number;
  totalTimeoutMs: number;
  startedAt: number;
  deadlineAt: number;
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
  const totalTimeoutMs = boundedTimeout(
    retryConfig.totalTimeoutMs ?? OPENROUTER_ACTION_BUDGET_MS,
    OPENROUTER_ACTION_BUDGET_MS,
  );
  const relativeDeadlineAt = startedAt + totalTimeoutMs;
  const configuredAbsolute = retryConfig.absoluteDeadlineAtMs;
  const deadlineAt = configuredAbsolute == null || !Number.isFinite(configuredAbsolute)
    ? relativeDeadlineAt
    : Math.min(relativeDeadlineAt, configuredAbsolute);
  return { requestTimeoutMs, totalTimeoutMs, startedAt, deadlineAt };
}

function remainingTotalMs(deadline: NonStreamingDeadline, now: number): number {
  return deadline.deadlineAt - now;
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
  if (remaining <= 0) throw totalTimeoutError(deadline);
  return Math.max(1, Math.min(deadline.requestTimeoutMs, Math.floor(remaining)));
}

export function assertRetryDelayFits(
  deadline: NonStreamingDeadline,
  delayMs: number,
  now: number,
): void {
  const remaining = remainingTotalMs(deadline, now);
  if (delayMs >= remaining) throw totalTimeoutError(deadline);
}
