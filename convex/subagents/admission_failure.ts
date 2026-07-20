import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { scheduleInitialParentResumeGates } from "./parent_resume_gate";
import { isTerminalSubagentStatus } from "./shared";

export async function failSubagentAdmission(
  ctx: MutationCtx,
  runId: Id<"subagentRuns">,
  expectedWorkId: string,
  status: "failed" | "cancelled",
  error: string,
): Promise<void> {
  const child = await ctx.db.get(runId);
  if (
    !child
    || child.workpoolOperationId !== expectedWorkId
    || child.workflowId
    || isTerminalSubagentStatus(child.status)
  ) return;
  const batch = await ctx.db.get(child.batchId);
  if (!batch || batch.status === "cancelled") return;
  const now = Date.now();
  await ctx.db.patch(child._id, {
    status,
    error: error.slice(0, 2_000),
    completedAt: now,
    updatedAt: now,
  });
  const runs = await ctx.db
    .query("subagentRuns")
    .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
    .collect();
  const statuses = runs.map((run) =>
    run._id === child._id ? status : run.status
  );
  const completedChildCount = statuses.filter(isTerminalSubagentStatus).length;
  const failedChildCount = statuses.filter((value) =>
    value === "failed" || value === "timedOut"
  ).length;
  const allTerminal = completedChildCount === runs.length;
  await ctx.db.patch(batch._id, {
    completedChildCount,
    failedChildCount,
    ...(allTerminal && batch.status === "running_children"
      ? {
          status: "waiting_to_resume" as const,
          continuationScheduledAt: now,
          parentRecoveryScheduledAt: now,
        }
      : {}),
    updatedAt: now,
  });
  if (allTerminal && batch.status === "running_children") {
    await scheduleInitialParentResumeGates(ctx, batch._id);
  }
}
