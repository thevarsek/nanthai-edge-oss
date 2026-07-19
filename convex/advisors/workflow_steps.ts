import { vResultValidator } from "@convex-dev/workflow";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { durableWorkflow, interactiveWorkpool } from "../execution/components";
import type { DeferredGenerationSnapshot } from "./types";
import { isTerminalAdvisorRun } from "./shared";
import {
  heartbeatAdvisorBatch,
  linkAdvisorComponent,
} from "./execution_lifecycle";
import type { DataModel, Id } from "../_generated/dataModel";
import { finalizeAdvisorRun } from "./lifecycle";
import { reconcileOwnedWorkflowHandler } from "../execution/workflow_lifecycle";
import { startGenerationDispatchHandler } from "../chat/generation_dispatch_workflow";
import { terminalizeExecutionComponentByOperation } from "../execution/component_refs";
import { scheduleAdvisorSynthesisWatchdog } from "./workflow_watchdog";
import { scheduleWorkpoolCompletionWatchdog } from
  "../execution/workpool_watchdog_schedule";
import { failAdvisorSynthesis } from "./synthesis_failure";
import { reconcileAdvisorSynthesisWorkHandler } from
  "./synthesis_work_reconciliation";
const advisorCompletionContext = v.object({ runId: v.id("advisorRuns") });
const synthesisCompletionContext = v.object({
  batchId: v.id("advisorBatches"),
  assistantMessageId: v.optional(v.id("messages")),
});
const advisorSynthesisWorkflowCompletionRef = makeFunctionReference<"mutation">(
  "advisors/workflow_steps:reconcileAdvisorSynthesisWorkflow",
);
export const reconcileAdvisorWork = interactiveWorkpool.defineOnComplete<
  DataModel,
  typeof advisorCompletionContext
>({
  context: advisorCompletionContext,
  handler: async (ctx, args) => {
    await terminalizeExecutionComponentByOperation(
      ctx,
      "interactive-workpool",
      String(args.workId),
      args.result.kind === "success"
        ? "completed"
        : args.result.kind === "canceled" ? "cancelled" : "failed",
    );
    if (args.result.kind === "success") return;
    const run = await ctx.db.get(args.context.runId as Id<"advisorRuns">);
    if (run?.leaseExpiresAt && run.leaseExpiresAt > Date.now()) {
      await ctx.scheduler.runAt(
        run.leaseExpiresAt + 1,
        internal.advisors.workflow_steps.reconcileAdvisorWorkLeaseExpiry,
        {
          runId: run._id,
          outcome: args.result.kind === "canceled" ? "cancelled" : "failed",
          error: (args.result.kind === "failed"
            ? args.result.error
            : "Advisor work was cancelled").slice(0, 2_000),
        },
      );
      return;
    }
    await finalizeAdvisorRun(ctx, {
      runId: args.context.runId as Id<"advisorRuns">,
      status: args.result.kind === "canceled" ? "cancelled" : "failed",
      errorCode: args.result.kind === "canceled"
        ? "ADVISOR_CANCELLED"
        : "ADVISOR_WORKPOOL_FAILED",
      errorMessage: args.result.kind === "failed"
        ? args.result.error
        : "Advisor work was cancelled",
    });
  },
});
export const reconcileAdvisorWorkLeaseExpiry = internalMutation({
  args: {
    runId: v.id("advisorRuns"),
    outcome: v.union(v.literal("failed"), v.literal("cancelled")),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || isTerminalAdvisorRun(run.status)) return null;
    if (run.leaseExpiresAt && run.leaseExpiresAt > Date.now()) {
      await ctx.scheduler.runAt(
        run.leaseExpiresAt + 1,
        internal.advisors.workflow_steps.reconcileAdvisorWorkLeaseExpiry,
        args,
      );
      return null;
    }
    await finalizeAdvisorRun(ctx, {
      runId: run._id,
      status: args.outcome,
      errorCode: args.outcome === "cancelled"
        ? "ADVISOR_CANCELLED"
        : "ADVISOR_WORKPOOL_FAILED",
      errorMessage: args.error,
    });
    return null;
  },
});

export const reconcileAdvisorSynthesisWork = interactiveWorkpool.defineOnComplete<
  DataModel,
  typeof synthesisCompletionContext
>({
  context: synthesisCompletionContext,
  handler: async (ctx, args) => {
    await reconcileAdvisorSynthesisWorkHandler(ctx, {
      workId: String(args.workId),
      result: args.result,
      context: args.context,
    });
  },
});

export const reconcileAdvisorSynthesisWorkflow = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: synthesisCompletionContext,
  },
  returns: v.null(),
  handler: reconcileAdvisorSynthesisWorkflowHandler,
});

export async function reconcileAdvisorSynthesisWorkflowHandler(
  ctx: MutationCtx,
  args: {
    workflowId: string;
    result: { kind: "success"; returnValue: unknown }
      | { kind: "failed"; error: string }
      | { kind: "canceled" };
    context: { batchId: Id<"advisorBatches"> };
  },
): Promise<null> {
    await reconcileOwnedWorkflowHandler(ctx, {
      workflowId: args.workflowId,
      result: args.result,
      context: {},
    });
    if (args.result.kind !== "success") {
      await failAdvisorSynthesis(
        ctx,
        args.context.batchId,
        args.result.kind === "failed" ? args.result.error : "Advisor synthesis was cancelled",
      );
    }
    return null;
}

export const dispatchAdvisorBatch = internalMutation({
  args: { batchId: v.id("advisorBatches") },
  returns: v.object({ terminal: v.boolean() }),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.status === "cancelled") return { terminal: true };
    await heartbeatAdvisorBatch(ctx, batch);
    const runs = await ctx.db
      .query("advisorRuns")
      .withIndex("by_batch", (query) => query.eq("batchId", args.batchId))
      .collect();
    for (const run of runs) {
      if (isTerminalAdvisorRun(run.status) || run.workpoolOperationId) continue;
      const workId = await interactiveWorkpool.enqueueAction(
        ctx,
        internal.advisors.actions.runAdvisor,
        { runId: run._id },
        {
          retry: false,
          name: "advisor-consultation",
          onComplete: internal.advisors.workflow_steps.reconcileAdvisorWork,
          context: { runId: run._id },
        },
      );
      await ctx.db.patch(run._id, { workpoolOperationId: workId });
      await linkAdvisorComponent(
        ctx,
        batch,
        workId,
        `advisor-consultation:${String(run._id)}`,
      );
      await scheduleWorkpoolCompletionWatchdog(ctx, {
        kind: "advisor_consultation",
        operationId: String(workId),
        runId: run._id,
      });
    }
    const terminal =
      runs.length === 0 ||
      runs.every((run) => isTerminalAdvisorRun(run.status));
    if (!terminal && batch.status === "queued") {
      await ctx.db.patch(batch._id, {
        status: "running",
        updatedAt: Date.now(),
      });
    }
    return { terminal };
  },
});

export const dispatchDeferredGeneration = internalMutation({
  args: { batchId: v.id("advisorBatches") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (
      !batch ||
      batch.status === "cancelled" ||
      batch.generationDispatchedAt != null
    ) {
      return null;
    }
    await heartbeatAdvisorBatch(ctx, batch);
    const snapshot = batch.generationSnapshot as DeferredGenerationSnapshot;
    const operationIds: string[] = [];
    if (snapshot.kind === "generation" && snapshot.args) {
      const operationId = await startGenerationDispatchHandler(
        ctx,
        { ...snapshot.args, enqueuedAt: Date.now() },
      );
      operationIds.push(operationId);
    } else if (
      snapshot.kind === "advanced_search" &&
      Array.isArray(snapshot.requests)
    ) {
      for (const request of snapshot.requests) {
        const operationId = await interactiveWorkpool.enqueueAction(
          ctx,
          internal.search.actions.runWebSearch,
          request,
          {
            retry: false,
            name: "advisor-web-search",
            onComplete: internal.advisors.workflow_steps.reconcileAdvisorSynthesisWork,
            context: {
              batchId: batch._id,
              assistantMessageId: request.assistantMessageId,
            },
          },
        );
        operationIds.push(operationId);
        await scheduleAdvisorSynthesisWatchdog(ctx, {
          workflowId: String(operationId),
          batchId: batch._id,
          adapterId: "interactive-workpool",
          assistantMessageId: request.assistantMessageId,
        });
        await linkAdvisorComponent(
          ctx,
          batch,
          operationId,
          "advisor-web-search",
        );
      }
    } else if (snapshot.kind === "research_paper" && snapshot.request) {
      const operationId = await durableWorkflow.start(
        ctx,
        internal.search.research_workflow.runResearchPaperWorkflow,
        {
          ...snapshot.request,
          parentExecutionRunId: batch.executionRunId,
        },
        {
          startAsync: true,
          onComplete: advisorSynthesisWorkflowCompletionRef,
          context: { batchId: batch._id },
        },
      );
      operationIds.push(operationId);
      await scheduleAdvisorSynthesisWatchdog(ctx, {
        workflowId: String(operationId),
        batchId: batch._id,
        adapterId: "convex-workflow",
      });
      // Its child execution is explicitly parented to this Advisor execution.
    } else {
      throw new Error("INVALID_ADVISOR_GENERATION_SNAPSHOT");
    }
    await ctx.db.patch(batch._id, {
      status: "synthesizing",
      generationDispatchedAt: Date.now(),
      generationOperationIds: operationIds,
      updatedAt: Date.now(),
    });
    return null;
  },
});
