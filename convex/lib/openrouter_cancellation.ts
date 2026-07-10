const DEFAULT_POLL_INTERVAL_MS = 250;
const MIN_POLL_INTERVAL_MS = 25;
const MAX_POLL_INTERVAL_MS = 1_000;

export class OpenRouterTransportCancelledError extends Error {
  constructor() {
    super("OpenRouter transport cancelled");
    this.name = "OpenRouterTransportCancelledError";
  }
}

export function isOpenRouterTransportCancelledError(
  error: unknown,
): error is OpenRouterTransportCancelledError {
  return error instanceof OpenRouterTransportCancelledError;
}

export async function cancellationWasRequested(
  isCancelled: (() => Promise<boolean>) | undefined,
): Promise<boolean> {
  if (!isCancelled) return false;
  try {
    return await isCancelled();
  } catch {
    // A transient Convex query failure must not cancel provider work. The next
    // poll (or the existing transport deadline) still provides a safe bound.
    return false;
  }
}

export function watchForCancellation(args: {
  isCancelled?: () => Promise<boolean>;
  pollIntervalMs?: number;
  onCancelled: () => void;
}): () => void {
  if (!args.isCancelled) return () => {};
  const intervalMs = Math.max(
    MIN_POLL_INTERVAL_MS,
    Math.min(MAX_POLL_INTERVAL_MS, args.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
  );
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const poll = async (): Promise<void> => {
    const cancelled = await cancellationWasRequested(args.isCancelled);
    if (stopped) return;
    if (cancelled) {
      args.onCancelled();
      return;
    }
    timer = setTimeout(() => {
      void poll();
    }, intervalMs);
  };

  timer = setTimeout(() => {
    void poll();
  }, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function sleepWithAbortSignal(
  durationMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    throw abortError();
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, durationMs);
    const handleAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", handleAbort);
      reject(abortError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function abortError(): Error {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
}
