import { type ObjectType, v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { linkExecutionComponent } from "../execution/component_refs";
import { durableWorkflow } from "../execution/components";
import { subagentWorkflowCompletionRef } from "./workflow_lifecycle";
import { scheduleSubagentWorkflowWatchdog } from "./subagent_workflow_watchdog";

export const subagentWorkflowArgs = {
  runId: v.id("subagentRuns"),
  executionRunId: v.id("executionRuns"),
  nextInvocationOffset: v.optional(v.string()),
};

export type SubagentWorkflowArgs = ObjectType<typeof subagentWorkflowArgs>;

type SubagentSuccessorArgs = SubagentWorkflowArgs & {
  predecessorWorkflowId: string;
  attemptId: Id<"executionAttempts">;
  fence: number;
};

interface SubagentSuccessorDeps {
  startWorkflow: (ctx: MutationCtx, args: SubagentWorkflowArgs) => Promise<string>;
  linkComponent: (
    ctx: MutationCtx,
    args: {
      runId: Id<"executionRuns">;
      attemptId: Id<"executionAttempts">;
      fence: number;
      operationId: string;
      role: string;
    },
  ) => Promise<unknown>;
  scheduleCleanup?: (
    ctx: MutationCtx,
    workflowId: string,
  ) => Promise<void>;
}

const defaultSubagentSuccessorDeps: SubagentSuccessorDeps = {
  startWorkflow: async (ctx, args): Promise<string> => String(await durableWorkflow.start(
    ctx,
    internal.subagents.subagent_workflow.runSubagentWorkflow,
    args,
    {
      startAsync: true,
      onComplete: subagentWorkflowCompletionRef,
      context: { runId: args.runId },
    },
  )),
  linkComponent: async (ctx, args): Promise<unknown> => await linkExecutionComponent(ctx, {
    ...args,
    adapterId: "convex-workflow",
  }),
  scheduleCleanup: async (ctx, workflowId) => {
    await ctx.scheduler.runAfter(
      60_000,
      internal.execution.owned_workflow_cleanup.cleanupOwnedWorkflow,
      { workflowId },
    );
  },
};

function successorRole(nextInvocationOffset: string): string {
  return `subagent-workflow-continuation:${nextInvocationOffset}`;
}

export async function startSubagentSuccessorHandler(
  ctx: MutationCtx,
  args: SubagentSuccessorArgs,
  deps: SubagentSuccessorDeps = defaultSubagentSuccessorDeps,
): Promise<string | null> {
  const {
    predecessorWorkflowId: _predecessorWorkflowId,
    attemptId,
    fence,
    ...workflowArgs
  } = args;
  const child = await ctx.db.get(args.runId);
  if (!child || child.status !== "waiting_continuation") return null;
  const [batch, executionRun, attempt] = await Promise.all([
    ctx.db.get(child.batchId),
    ctx.db.get(args.executionRunId),
    ctx.db.get(attemptId),
  ]);
  const claimantId = `subagent-workflow:${String(args.runId)}`;
  if (
    !batch
    || batch.status === "cancelled"
    || !executionRun
    || !attempt
    || executionRun.activeAttemptId !== attempt._id
    || attempt.runId !== executionRun._id
    || attempt.fence !== fence
    || attempt.claimantId !== claimantId
    || attempt.status !== "running"
    || ["completed", "failed", "cancelled"].includes(executionRun.state)
    || executionRun.state === "cancelling"
  ) {
    return null;
  }

  const role = successorRole(args.nextInvocationOffset ?? "0");
  const [existing, predecessor] = await Promise.all([
    ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_role", (q) =>
        q.eq("runId", executionRun._id).eq("role", role)
      )
      .unique(),
    ctx.db
      .query("executionComponentRefs")
      .withIndex("by_operation", (q) =>
        q.eq("adapterId", "convex-workflow").eq("operationId", args.predecessorWorkflowId)
      )
      .unique(),
  ]);
  if (!predecessor || predecessor.runId !== executionRun._id) {
    throw new Error("SUBAGENT_PREDECESSOR_COMPONENT_NOT_FOUND");
  }

  const completePredecessor = async (): Promise<void> => {
    if (predecessor.status === "active" || predecessor.status === "cancel_requested") {
      const now = Date.now();
      await ctx.db.patch(predecessor._id, {
        status: "completed",
        terminalAt: now,
        updatedAt: now,
      });
      await deps.scheduleCleanup?.(ctx, args.predecessorWorkflowId);
    }
  };
  if (existing) {
    if (
      child.workflowId
      && child.workflowId !== args.predecessorWorkflowId
      && child.workflowId !== existing.operationId
    ) {
      await completePredecessor();
      return child.workflowId;
    }
    await ctx.db.patch(child._id, {
      workflowId: existing.operationId,
      updatedAt: Date.now(),
    });
    await completePredecessor();
    return existing.operationId;
  }

  const workflowId = await deps.startWorkflow(ctx, workflowArgs);
  await deps.linkComponent(ctx, {
    runId: executionRun._id,
    attemptId: attempt._id,
    fence: attempt.fence,
    operationId: workflowId,
    role,
  });
  await ctx.db.patch(child._id, {
    workflowId,
    updatedAt: Date.now(),
  });
  await scheduleSubagentWorkflowWatchdog(ctx, { workflowId, runId: child._id });
  await completePredecessor();
  return workflowId;
}

export const startSubagentSuccessor = internalMutation({
  args: {
    ...subagentWorkflowArgs,
    predecessorWorkflowId: v.string(),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> =>
    await startSubagentSuccessorHandler(ctx, args),
});
