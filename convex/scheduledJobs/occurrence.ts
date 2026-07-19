import type { Id } from "../_generated/dataModel";

export function scheduledOccurrenceId(
  jobId: Id<"scheduledJobs">,
  runAt: number,
): string {
  return `scheduled:${String(jobId)}:${Math.floor(runAt)}`;
}

export function manualOccurrenceId(): string {
  return `manual:${crypto.randomUUID()}`;
}

export function apiOccurrenceId(
  requestId: string,
  idempotencyKey?: string,
): string {
  return `api:${idempotencyKey ?? requestId}`;
}

export function resolveScheduledOccurrenceStart(
  job: {
    activeExecutionId?: string;
    activeOccurrenceId?: string;
    activeWorkflowId?: string;
  },
  occurrenceId: string,
): { kind: "idle" } | { kind: "duplicate"; workflowId: string | null }
  | { kind: "overlap" } {
  if (!job.activeExecutionId) return { kind: "idle" };
  if (job.activeOccurrenceId === occurrenceId) {
    return { kind: "duplicate", workflowId: job.activeWorkflowId ?? null };
  }
  return { kind: "overlap" };
}
