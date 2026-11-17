import type { ExecutionProjection, PendingToolConfirmation } from "@/hooks/useChat";

/** Pending confirmations from the run projection, oldest first, one per run. */
export function pendingToolConfirmations(runs: ExecutionProjection[]): PendingToolConfirmation[] {
  return runs
    .flatMap((run) => run.pendingConfirmation ? [run.pendingConfirmation] : [])
    .sort((left, right) => left.createdAt - right.createdAt);
}

export function formatConfirmationCountdown(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
