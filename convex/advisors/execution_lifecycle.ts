import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  heartbeatDomainExecution,
  linkDomainComponent,
  terminalizeDomainExecution,
  type DomainExecutionRef,
} from "../execution/domain_lifecycle";
import { isTerminalAdvisorRun } from "./shared";

export function advisorExecutionRef(
  batch: Doc<"advisorBatches">,
): DomainExecutionRef | null {
  if (
    !batch.executionRunId ||
    !batch.executionAttemptId ||
    batch.executionFence === undefined ||
    !batch.executionClaimantId
  )
    return null;
  return {
    runId: batch.executionRunId,
    attemptId: batch.executionAttemptId,
    fence: batch.executionFence,
    claimantId: batch.executionClaimantId,
  };
}

export async function heartbeatAdvisorBatch(
  ctx: MutationCtx,
  batch: Doc<"advisorBatches">,
): Promise<DomainExecutionRef | null> {
  const execution = advisorExecutionRef(batch);
  if (execution) await heartbeatDomainExecution(ctx, execution);
  return execution;
}

export const heartbeatBatch = internalMutation({
  args: { batchId: v.id("advisorBatches") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (batch) await heartbeatAdvisorBatch(ctx, batch);
    return null;
  },
});

export const terminalizeBatch = internalMutation({
  args: {
    batchId: v.id("advisorBatches"),
    outcome: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    summary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return null;
    const execution = advisorExecutionRef(batch);
    if (execution) {
      await terminalizeDomainExecution(
        ctx,
        execution,
        args.outcome,
        args.summary,
      );
    }
    if (
      args.outcome === "failed" &&
      batch.status !== "completed" &&
      batch.status !== "failed" &&
      batch.status !== "cancelled"
    ) {
      await ctx.db.patch(batch._id, {
        status: "failed",
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export async function linkAdvisorComponent(
  ctx: MutationCtx,
  batch: Doc<"advisorBatches">,
  operationId: string,
  role: string,
  adapterId: "convex-workflow" | "interactive-workpool" = "interactive-workpool",
): Promise<void> {
  const execution = advisorExecutionRef(batch);
  if (!execution) return;
  await linkDomainComponent(ctx, execution, {
    adapterId,
    operationId,
    role,
  });
}

export async function cancelAdvisorForExecutionRun(
  ctx: MutationCtx,
  executionRunId: Id<"executionRuns">,
): Promise<boolean> {
  const batch = await ctx.db
    .query("advisorBatches")
    .withIndex("by_execution_run", (q) => q.eq("executionRunId", executionRunId))
    .unique();
  if (!batch || ["completed", "failed", "cancelled"].includes(batch.status)) return true;
  const runs = await ctx.db
    .query("advisorRuns")
    .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
    .take(20);
  const now = Date.now();
  for (const run of runs) {
    if (!isTerminalAdvisorRun(run.status)) {
      await ctx.db.patch(run._id, {
        status: "cancelled",
        stage: "cancelled",
        errorCode: "ADVISOR_CANCELLED",
        errorMessage: "Advisor execution cancelled",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        completedAt: now,
        updatedAt: now,
      });
    }
  }
  await ctx.db.patch(batch._id, { status: "cancelled", updatedAt: now });
  return true;
}
