import { internalMutation, type MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { durableWorkflow, interactiveWorkpool } from "./components";
import {
  linkExecutionComponent,
  terminalizeExecutionComponentByOperation,
} from "./component_refs";
import { createExecutionRun } from "./runs";
import { subagentWorkflowCompletionRef } from "../subagents/workflow_lifecycle";
import { scheduleSubagentWorkflowWatchdog } from
  "../subagents/subagent_workflow_watchdog";
import type { DataModel, Id } from "../_generated/dataModel";
import { isTerminalSubagentStatus } from "../subagents/shared";
import { failSubagentAdmission } from "../subagents/admission_failure";
import { scheduleSubagentAdmissionWatchdog } from
  "../subagents/subagent_admission_watchdog";

const subagentAdmissionContext = v.object({
  runId: v.id("subagentRuns"),
});

export const reconcileSubagentAdmission = interactiveWorkpool.defineOnComplete<
  DataModel,
  typeof subagentAdmissionContext
>({
  context: subagentAdmissionContext,
  handler: async (ctx, args) => {
    await terminalizeExecutionComponentByOperation(
      ctx,
      "interactive-workpool",
      String(args.workId),
      args.result.kind === "success"
        ? "completed"
        : args.result.kind === "canceled" ? "cancelled" : "failed",
    );
    if (args.result.kind !== "success") {
      await failSubagentAdmission(
        ctx,
        args.context.runId,
        String(args.workId),
        args.result.kind === "canceled" ? "cancelled" : "failed",
        args.result.kind === "failed"
          ? `Subagent admission failed: ${args.result.error}`
          : "Subagent admission cancelled",
      );
    }
  },
});

export const startSubagentWorkflowFromPool = internalMutation({
  args: {
    runId: v.id("subagentRuns"),
    executionRunId: v.id("executionRuns"),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const child = await ctx.db.get(args.runId);
    if (!child || isTerminalSubagentStatus(child.status)) return null;
    if (child.workflowId) return child.workflowId;
    const batch = await ctx.db.get(child.batchId);
    const executionRun = await ctx.db.get(args.executionRunId);
    const attempt = executionRun?.activeAttemptId
      ? await ctx.db.get(executionRun.activeAttemptId)
      : null;
    if (!batch || batch.status === "cancelled" || !executionRun || !attempt) return null;
    const existingWorkflow = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_role", (query) => query
        .eq("runId", executionRun._id)
        .eq("role", "subagent-workflow"))
      .unique();
    if (
      existingWorkflow
      && (existingWorkflow.status === "active" || existingWorkflow.status === "cancel_requested")
    ) {
      await ctx.db.patch(child._id, {
        workflowId: existingWorkflow.operationId,
        updatedAt: Date.now(),
      });
      await scheduleSubagentWorkflowWatchdog(ctx, {
        workflowId: existingWorkflow.operationId,
        runId: child._id,
      });
      return existingWorkflow.operationId;
    }
    const workflowId = String(await durableWorkflow.start(
      ctx,
      internal.subagents.subagent_workflow.runSubagentWorkflow,
      args,
      {
        startAsync: true,
        onComplete: subagentWorkflowCompletionRef,
        context: { runId: args.runId },
      },
    ));
    await linkExecutionComponent(ctx, {
      runId: executionRun._id,
      attemptId: attempt._id,
      fence: attempt.fence,
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "subagent-workflow",
    });
    await ctx.db.patch(child._id, { workflowId, updatedAt: Date.now() });
    await scheduleSubagentWorkflowWatchdog(ctx, { workflowId, runId: child._id });
    return workflowId;
  },
});

export async function enqueueSubagentHandler(
  ctx: MutationCtx,
  args: { runId: Id<"subagentRuns"> },
): Promise<string> {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("SUBAGENT_RUN_NOT_FOUND");
    if (run.workpoolOperationId) return run.workpoolOperationId;
    const batch = await ctx.db.get(run.batchId);
    if (!batch) throw new Error("SUBAGENT_BATCH_NOT_FOUND");
    const parentJob = await ctx.db.get(batch.parentJobId);
    const execution = await createExecutionRun(ctx, {
      userId: batch.userId,
      runKey: `subagent:${String(run._id)}`,
      kind: "subagent",
      requestedPlacement: "cloud",
      chatId: batch.chatId,
      sourceMessageId: batch.parentMessageId,
      generationJobId: batch.parentJobId,
      domainType: "subagentRun",
      domainId: String(run._id),
      parentRunId: parentJob?.executionRunId,
      initialAttempt: {
        executorKind: "convex_workflow",
        placement: "cloud",
        adapterId: "convex-workflow",
        modelId: (batch.participantSnapshot as { participant?: { modelId?: string } })
          .participant?.modelId,
      },
    });
    const workId = await interactiveWorkpool.enqueueMutation(
      ctx,
      internal.execution.fanout_queues.startSubagentWorkflowFromPool,
      { ...args, executionRunId: execution.runId },
      {
        name: "subagent-admission",
        onComplete: internal.execution.fanout_queues.reconcileSubagentAdmission,
        context: { runId: args.runId },
      },
    );
    await linkExecutionComponent(ctx, {
      runId: execution.runId,
      attemptId: execution.attemptId,
      fence: execution.fence,
      adapterId: "interactive-workpool",
      operationId: workId,
      role: "subagent-admission",
    });
    await ctx.db.patch(args.runId, { workpoolOperationId: workId });
    await scheduleSubagentAdmissionWatchdog(ctx, {
      runId: args.runId,
      executionRunId: execution.runId,
      workId: String(workId),
    });
    return workId;
}

export const enqueueSubagent = internalMutation({
  args: { runId: v.id("subagentRuns") },
  returns: v.string(),
  handler: enqueueSubagentHandler,
});
