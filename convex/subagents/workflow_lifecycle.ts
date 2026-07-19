import { vResultValidator } from "@convex-dev/workflow";
import { makeFunctionReference } from "convex/server";
import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  isTerminalSubagentStatus,
} from "./shared";
import { scheduleInitialParentResumeGates } from "./parent_resume_gate";

export const subagentWorkflowCompletionRef = makeFunctionReference<"mutation">(
  "subagents/workflow_lifecycle:reconcileSubagentWorkflow",
);

type SubagentWorkflowResult = Infer<typeof vResultValidator>;

export async function reconcileSubagentWorkflowHandler(
  ctx: MutationCtx,
  args: {
    workflowId: string;
    result: SubagentWorkflowResult;
    context: { runId: Id<"subagentRuns"> };
  },
): Promise<null> {
  const child = await ctx.db.get(args.context.runId);
  if (
    !child
    || child.workflowId !== args.workflowId
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.execution.workflow_lifecycle.reconcileOwnedWorkflow,
      { workflowId: args.workflowId, result: args.result, context: {} },
    );
    return null;
  }
  const batch = await ctx.db.get(child.batchId);
  if (!batch || batch.status === "cancelled") {
    await ctx.scheduler.runAfter(
      0,
      internal.execution.workflow_lifecycle.reconcileOwnedWorkflow,
      { workflowId: args.workflowId, result: args.result, context: {} },
    );
    return null;
  }

  if (child.status === "waiting_continuation" && args.result.kind !== "success") {
    const predecessor = await ctx.db.query("executionComponentRefs")
      .withIndex("by_operation", (query) => query
        .eq("adapterId", "convex-workflow")
        .eq("operationId", args.workflowId))
      .unique();
    const attempt = predecessor?.attemptId
      ? await ctx.db.get(predecessor.attemptId)
      : null;
    if (predecessor?.attemptId && attempt) {
      await ctx.scheduler.runAfter(
        0,
        internal.subagents.subagent_workflow_handoff.startSubagentSuccessor,
        {
          runId: child._id,
          executionRunId: predecessor.runId,
          predecessorWorkflowId: args.workflowId,
          nextInvocationOffset: String(child.continuationCount ?? 0),
          attemptId: predecessor.attemptId,
          fence: attempt.fence,
        },
      );
      return null;
    }
  }
  await ctx.scheduler.runAfter(
    0,
    internal.execution.workflow_lifecycle.reconcileOwnedWorkflow,
    { workflowId: args.workflowId, result: args.result, context: {} },
  );

  const now = Date.now();
  const childWasTerminal = isTerminalSubagentStatus(child.status);
  const status = childWasTerminal
    ? child.status
    : args.result.kind === "canceled" ? "cancelled" : "failed";
  if (!childWasTerminal) {
    if (args.result.kind === "success") return null;
    await ctx.db.patch(child._id, {
      status,
      error: args.result.kind === "failed"
        ? `Subagent Workflow failed: ${args.result.error}`.slice(0, 2_000)
        : "Subagent Workflow cancelled",
      completedAt: now,
      updatedAt: now,
    });
  }
  const runs = await ctx.db
    .query("subagentRuns")
    .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
    .collect();
  const statuses = runs.map((run) => run._id === child._id ? status : run.status);
  const completedChildCount = statuses.filter(isTerminalSubagentStatus).length;
  const failedChildCount = statuses.filter(
    (runStatus) => runStatus === "failed" || runStatus === "timedOut",
  ).length;
  const allTerminal = completedChildCount === runs.length;
  const shouldResumeParent = allTerminal
    && (batch.status === "running_children" || batch.status === "waiting_to_resume")
    && batch.parentRecoveryScheduledAt === undefined;
  await ctx.db.patch(batch._id, {
    completedChildCount,
    failedChildCount,
    ...(allTerminal && batch.status === "running_children"
      ? { status: "waiting_to_resume" as const, continuationScheduledAt: now }
      : {}),
    ...(shouldResumeParent ? { parentRecoveryScheduledAt: now } : {}),
    updatedAt: now,
  });
  if (shouldResumeParent) {
    await scheduleInitialParentResumeGates(ctx, batch._id);
  } else if (
    allTerminal
    && batch.status === "resuming"
    && batch.parentRecoveryScheduledAt === undefined
  ) {
    await ctx.db.patch(batch._id, { parentRecoveryScheduledAt: now, updatedAt: now });
    await scheduleInitialParentResumeGates(ctx, batch._id);
  }
  return null;
}

export const reconcileSubagentWorkflow = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: v.object({ runId: v.id("subagentRuns") }),
  },
  returns: v.null(),
  handler: reconcileSubagentWorkflowHandler,
});
