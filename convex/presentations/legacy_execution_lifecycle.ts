import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { terminalizeAttempt } from "../execution/attempts";

export type LegacyPresentationTerminalOutcome = "completed" | "failed" | "cancelled";

function executionRunIsTerminal(run: Doc<"executionRuns">): boolean {
  return run.state === "completed" || run.state === "failed" || run.state === "cancelled";
}

function executionAttemptIsTerminal(attempt: Doc<"executionAttempts">): boolean {
  return attempt.status === "completed"
    || attempt.status === "failed"
    || attempt.status === "cancelled"
    || attempt.status === "superseded";
}

export function isLegacyPresentationExecution(
  executionRun: Doc<"executionRuns">,
  attempt: Doc<"executionAttempts">,
  presentationRun: Doc<"presentationGenerationRuns">,
): boolean {
  return executionRun.userId === presentationRun.userId
    && executionRun.kind === "presentation"
    && executionRun.domainType === "presentation"
    && executionRun.domainId === String(presentationRun.projectId)
    && executionRun.generationJobId === presentationRun.jobId
    && attempt.runId === executionRun._id
    && attempt.userId === presentationRun.userId
    && attempt.orchestrationEngine === "legacy_scheduler";
}

async function currentLegacyExecution(
  ctx: MutationCtx,
  run: Doc<"presentationGenerationRuns">,
): Promise<{
  executionRun: Doc<"executionRuns">;
  attempt: Doc<"executionAttempts">;
} | null> {
  if (run.workflowId || !run.executionRunId || !run.executionAttemptId
      || run.executionFence === undefined) return null;
  const [executionRun, attempt] = await Promise.all([
    ctx.db.get(run.executionRunId),
    ctx.db.get(run.executionAttemptId),
  ]);
  if (!executionRun
      || !attempt
      || executionRun.activeAttemptId !== attempt._id
      || attempt.fence !== run.executionFence
      || attempt.claimantId !== `presentation:${String(run.projectId)}`
      || !isLegacyPresentationExecution(executionRun, attempt, run)) {
    return null;
  }
  return { executionRun, attempt };
}

export async function hasCurrentLegacyPresentationExecution(
  ctx: MutationCtx,
  run: Doc<"presentationGenerationRuns">,
): Promise<boolean> {
  return (await currentLegacyExecution(ctx, run)) !== null;
}

export async function terminalizeLegacyPresentationExecution(
  ctx: MutationCtx,
  run: Doc<"presentationGenerationRuns">,
  outcome: LegacyPresentationTerminalOutcome,
  summary: string,
): Promise<boolean> {
  const current = await currentLegacyExecution(ctx, run);
  if (!current
      || executionRunIsTerminal(current.executionRun)
      || executionAttemptIsTerminal(current.attempt)) {
    return false;
  }
  const effectiveOutcome = current.executionRun.state === "cancelling"
    ? "cancelled"
    : outcome;
  const result = await terminalizeAttempt(ctx, {
    attemptId: current.attempt._id,
    fence: current.attempt.fence,
    claimantId: current.attempt.claimantId,
    outcome: effectiveOutcome,
    summary,
    allowExpiredLease: true,
    allowWaiting: true,
  });
  return result.changed;
}
