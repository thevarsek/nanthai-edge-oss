import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function closeRunWriterForCancellation(
  ctx: Pick<MutationCtx, "db">,
  runId: Id<"executionRuns">,
  requestedBy: string,
  reason: string,
  now = Date.now(),
): Promise<Doc<"executionRuns"> | null> {
  const run = await ctx.db.get(runId);
  if (!run) return null;
  if (["completed", "failed", "cancelled"].includes(run.state)) return run;
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
