import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { scheduleBackendAnalytics } from "../analytics/backend_events";
import type { OpenRouterUsage } from "../lib/openrouter_types";
import { conciseAdvisorFailure } from "../lib/openrouter_responses_error";
import { isTerminalAdvisorRun } from "./shared";
import type { WorkId } from "@convex-dev/workpool";
import { interactiveWorkpool } from "../execution/components";
import { durableWorkflow } from "../execution/components";
import type { WorkflowId } from "@convex-dev/workflow";
import { ADVISOR_BATCH_TERMINAL_EVENT } from "./advisor_workflow";
import { heartbeatAdvisorBatch } from "./execution_lifecycle";
import { cancelAssistantGenerationRows } from "./cancel_generation_rows";
import { scheduleLegacyDeferredGeneration } from "./legacy_deferred_generation";
import { effectiveUsageCost, terminalStage } from "./terminal_helpers";

type RunTerminalStatus = Extract<
  Doc<"advisorRuns">["status"],
  "completed" | "failed" | "timedOut" | "cancelled"
>;

export async function finalizeAdvisorRun(
  ctx: MutationCtx,
  args: {
    runId: Id<"advisorRuns">;
    status: RunTerminalStatus;
    advice?: string;
    actualModelId?: string;
    errorCode?: string;
    errorMessage?: string;
    responseId?: string;
    outputItemId?: string;
    replayItems?: unknown[];
    usage?: OpenRouterUsage;
  },
): Promise<{
  changed: boolean;
  batchId?: Id<"advisorBatches">;
  allTerminal: boolean;
}> {
  const run = await ctx.db.get(args.runId);
  if (!run || isTerminalAdvisorRun(run.status)) {
    return { changed: false, batchId: run?.batchId, allTerminal: true };
  }
  const owningBatch = await ctx.db.get(run.batchId);
  if (owningBatch) await heartbeatAdvisorBatch(ctx, owningBatch);
  const now = Date.now();
  const stage = terminalStage(args.status);
  await ctx.db.patch(run._id, {
    status: args.status,
    stage,
    advice: args.advice,
    partialAdvice: args.advice ?? run.partialAdvice,
    actualModelId: args.actualModelId,
    errorCode: args.errorCode,
    errorMessage:
      args.errorMessage === undefined
        ? undefined
        : conciseAdvisorFailure(args.errorMessage),
    responseId: args.responseId,
    outputItemId: args.outputItemId,
    replayItems: args.replayItems,
    usage: args.usage,
    cost: effectiveUsageCost(args.usage),
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    lastActivityAt: now,
    completedAt: now,
    updatedAt: now,
  });
  if (args.usage) {
    const batch = await ctx.db.get(run.batchId);
    const messageId = batch?.assistantMessageIds[0];
    if (batch && messageId) {
      await ctx.scheduler.runAfter(
        0,
        internal.chat.mutations.storeAncillaryCost,
        {
          messageId,
          chatId: batch.chatId,
          userId: batch.userId,
          modelId: args.actualModelId ?? run.requestedModelId,
          ...args.usage,
          source: "advisor",
          generationId: args.responseId,
        },
      );
    }
  }
  const allTerminal = await updateBatchAndSchedule(
    ctx,
    run.batchId,
    run._id,
    args.status,
  );
  return { changed: true, batchId: run.batchId, allTerminal };
}

export async function cancelAdvisorBatchRows(
  ctx: MutationCtx,
  batch: Doc<"advisorBatches">,
): Promise<boolean> {
  if (
    batch.status === "completed" ||
    batch.status === "failed" ||
    batch.status === "cancelled"
  ) {
    return false;
  }
  const now = Date.now();
  const runs = await ctx.db
    .query("advisorRuns")
    .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
    .collect();
  for (const run of runs) {
    await cancelScheduled(ctx, run.scheduledFunctionId);
    if (run.workpoolOperationId) {
      await interactiveWorkpool
        .cancel(ctx, run.workpoolOperationId as WorkId)
        .catch(() => undefined);
    }
    await cancelScheduled(ctx, run.watchdogScheduledFunctionId);
    if (!isTerminalAdvisorRun(run.status)) {
      await ctx.db.patch(run._id, {
        status: "cancelled",
        stage: "cancelled",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
        lastActivityAt: now,
        completedAt: now,
        updatedAt: now,
      });
      await scheduleAdvisorFailureAnalytics(
        ctx,
        run,
        "cancelled",
        "ADVISOR_CANCELLED",
      );
    }
  }
  if (batch.workflowId) {
    await durableWorkflow
      .cancel(ctx, batch.workflowId as WorkflowId)
      .catch(() => undefined);
  }
  if ((batch.generationSnapshot as { kind?: string }).kind === "research_paper") {
    for (const operationId of batch.generationOperationIds ?? []) {
      await durableWorkflow
        .cancel(ctx, operationId as WorkflowId)
        .catch(() => undefined);
    }
  }
  for (const scheduledId of batch.scheduledFinalGenerationIds ?? []) {
    await cancelScheduled(ctx, scheduledId);
  }
  await cancelScheduled(ctx, batch.scheduledFinalGenerationId);
  await cancelAssistantGenerationRows(
    ctx,
    batch.assistantMessageIds,
    batch.userId,
    now,
  );
  if (batch.executionRunId) {
    await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
      runId: batch.executionRunId,
      requestedBy: batch.userId,
      reason: "Advisor batch cancelled",
    });
  }
  await ctx.db.patch(batch._id, { status: "cancelled", updatedAt: now });
  return true;
}

/** Stop only unfinished consultations and let the main response continue. */
export async function stopAdvisorBatchConsultations(
  ctx: MutationCtx,
  batch: Doc<"advisorBatches">,
): Promise<boolean> {
  if (
    batch.status === "completed" ||
    batch.status === "failed" ||
    batch.status === "cancelled"
  ) {
    return false;
  }
  const runs = await ctx.db
    .query("advisorRuns")
    .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
    .collect();
  let stopped = false;
  for (const run of runs) {
    if (isTerminalAdvisorRun(run.status)) continue;
    stopped = true;
    await cancelScheduled(ctx, run.scheduledFunctionId);
    await cancelScheduled(ctx, run.watchdogScheduledFunctionId);
    const finalization = await finalizeAdvisorRun(ctx, {
      runId: run._id,
      status: "cancelled",
      errorCode: "ADVISOR_CANCELLED",
      errorMessage:
        "Advisor consultation stopped. The main response continued.",
    });
    if (finalization.changed) {
      await scheduleAdvisorFailureAnalytics(
        ctx,
        run,
        "cancelled",
        "ADVISOR_CANCELLED",
      );
    }
  }
  return stopped;
}

export async function scheduleAdvisorFailureAnalytics(
  ctx: MutationCtx,
  run: Doc<"advisorRuns">,
  status: "timedOut" | "cancelled",
  errorCode: string,
): Promise<void> {
  const origin = run.startedAt ?? run.createdAt;
  await scheduleBackendAnalytics(
    ctx,
    run.userId,
    "advisor_consultation_failed",
    {
      chat_id: String(run.chatId),
      advisor_batch_id: String(run.batchId),
      advisor_run_id: String(run._id),
      persona_id: String(run.personaId),
      model_id: run.requestedModelId,
      web_search_enabled: run.allowWebSearch,
      duration_ms:
        typeof origin === "number" ? Math.max(0, Date.now() - origin) : null,
      status,
      error_code: errorCode,
    },
  );
}

async function updateBatchAndSchedule(
  ctx: MutationCtx,
  batchId: Id<"advisorBatches">,
  changedRunId: Id<"advisorRuns">,
  changedStatus: RunTerminalStatus,
): Promise<boolean> {
  const batch = await ctx.db.get(batchId);
  if (!batch || batch.status === "cancelled") return true;
  const runs = await ctx.db
    .query("advisorRuns")
    .withIndex("by_batch", (query) => query.eq("batchId", batchId))
    .collect();
  const statuses = runs.map((run) =>
    run._id === changedRunId ? changedStatus : run.status,
  );
  const completedRunCount = statuses.filter(
    (status) => status === "completed",
  ).length;
  const failedRunCount = statuses.filter(
    (status) => status === "failed" || status === "timedOut",
  ).length;
  const allTerminal = statuses.every(isTerminalAdvisorRun);
  const patch: Partial<Doc<"advisorBatches">> = {
    completedRunCount,
    failedRunCount,
    status: allTerminal ? "synthesizing" : "running",
    updatedAt: Date.now(),
  };
  if (allTerminal && batch.workflowId) {
    await durableWorkflow.sendEvent(ctx, {
      workflowId: batch.workflowId as WorkflowId,
      name: ADVISOR_BATCH_TERMINAL_EVENT,
    });
  } else if (allTerminal && batch.scheduledFinalGenerationAt == null) {
    const scheduledIds = await scheduleLegacyDeferredGeneration(
      ctx,
      batch.generationSnapshot,
    );
    patch.scheduledFinalGenerationAt = Date.now();
    patch.scheduledFinalGenerationId = scheduledIds[0];
    patch.scheduledFinalGenerationIds = scheduledIds;
  }
  await ctx.db.patch(batch._id, patch);
  return allTerminal;
}

async function cancelScheduled(
  ctx: MutationCtx,
  scheduledId: Id<"_scheduled_functions"> | undefined,
): Promise<void> {
  if (!scheduledId) return;
  try {
    await ctx.scheduler.cancel(scheduledId);
  } catch {
    // Already running or terminal.
  }
}
