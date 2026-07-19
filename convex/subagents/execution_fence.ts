import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { isTerminalSubagentStatus } from "./shared";

export interface SubagentExecutionFence {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
}

type ReadCtx = Pick<MutationCtx | QueryCtx, "db">;

/**
 * Legacy queue invocations have no execution token. Workflow-managed writes
 * carry both fields and are accepted only from the currently active attempt.
 */
export async function isCurrentSubagentExecution(
  ctx: ReadCtx,
  run: Doc<"subagentRuns">,
  token: SubagentExecutionFence,
): Promise<boolean> {
  const hasAttempt = token.executionAttemptId !== undefined;
  const hasFence = token.executionFence !== undefined;
  if (!hasAttempt && !hasFence) return true;
  if (!hasAttempt || !hasFence) return false;

  const batch = await ctx.db.get(run.batchId);
  if (!batch || batch.status === "cancelled") return false;
  const attempt = await ctx.db.get(token.executionAttemptId!);
  if (
    !attempt
    || attempt.status !== "running"
    || attempt.fence !== token.executionFence
    || attempt.claimantId !== `subagent-workflow:${String(run._id)}`
  ) {
    return false;
  }
  const executionRun = await ctx.db.get(attempt.runId);
  return Boolean(
    executionRun
    && executionRun.activeAttemptId === attempt._id
    && executionRun.state === "running"
    && !isTerminalSubagentStatus(run.status),
  );
}
