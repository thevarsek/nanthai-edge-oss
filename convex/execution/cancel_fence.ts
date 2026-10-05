import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { closeRuntimeNativeAgentGroupForAttempt } from
  "../runtime_host/native_agent_lifecycle";

export async function closeRunWriterForCancellation(
  ctx: MutationCtx,
  runId: Id<"executionRuns">,
  requestedBy: string,
  reason: string,
  now = Date.now(),
): Promise<Doc<"executionRuns"> | null> {
  const run = await ctx.db.get(runId);
  if (!run) return null;
  if (["completed", "failed", "cancelled"].includes(run.state)) return run;
  const attempt = run.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
  if (attempt?.runId === run._id) {
    await closeRuntimeNativeAgentGroupForAttempt(ctx, {
      attemptId: attempt._id,
      fence: attempt.fence,
      outcome: "cancelled",
      now,
    });
  }
  if (run.state === "cancelling") return run;
  const patch = {
    state: "cancelling" as const,
    cancelRequestedAt: run.cancelRequestedAt ?? now,
    cancelRequestedBy: run.cancelRequestedBy ?? requestedBy,
    terminalSummary: reason.slice(0, 2_000),
    updatedAt: now,
  };
  await ctx.db.patch(run._id, patch);
  return { ...run, ...patch };
}
