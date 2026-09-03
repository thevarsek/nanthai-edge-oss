import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cancelAndCleanupForExecutionRun } from "../analytics_workflows/cleanup";
import { cancelVideoForExecutionRun } from "../chat/video_cleanup";
import { clearAudioGenerationForExecutionRun } from "../chat/audio_cleanup";
import { cancelAdvisorForExecutionRun } from "../advisors/execution_lifecycle";
import { terminalizeAttempt } from "./attempts";
import { appendRunEventUnchecked } from "./events";

export interface OwnedComponent {
  componentRefId?: Id<"executionComponentRefs">;
  operationId: string;
  adapterId: string;
  cancelSafeAfter?: number;
  cancelAcknowledgedAt?: number;
}

export interface CancelRunStateResult {
  components: OwnedComponent[];
  localDone: boolean;
}

const RUN_CLEANUP_BATCH_SIZE = 40;

type ComponentAdapter = OwnedComponent["adapterId"] & (
  | "convex-workflow"
  | "interactive-workpool"
  | "background-workpool"
  | "maintenance-workpool"
  | "external-cloud"
  | "local-runtime"
);

function cancellationAdapter(adapterId: string): ComponentAdapter {
  if (
    adapterId === "convex-workflow"
    || adapterId === "interactive-workpool"
    || adapterId === "background-workpool"
    || adapterId === "maintenance-workpool"
    || adapterId === "external-cloud"
    || adapterId === "local-runtime"
  ) return adapterId;
  return "external-cloud";
}

export async function finalizeRunCancellationIfSettled(
  ctx: MutationCtx,
  runId: Id<"executionRuns">,
  now = Date.now(),
): Promise<boolean> {
  const run = await ctx.db.get(runId);
  if (!run) return false;
  if (run.state === "cancelled") return true;
  if (run.state !== "cancelling" || !run.activeAttemptId) return false;
  const pending = await Promise.all(
    (["active", "cancel_requested"] as const).map((status) => ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", status))
      .first()),
  );
  if (pending.some(Boolean)) return false;
  const attempt = await ctx.db.get(run.activeAttemptId);
  if (!attempt || attempt.fence < 1) return false;
  await appendRunEventUnchecked(ctx, run, {
    attemptId: attempt._id,
    fence: attempt.fence,
    type: "cancel_acknowledged",
    summary: "Owned execution components settled after cancellation request",
    now,
  });
  await terminalizeAttempt(ctx, {
    attemptId: attempt._id,
    fence: attempt.fence,
    outcome: "cancelled",
    summary: run.terminalSummary ?? "Execution cancelled",
    now,
  });
  return true;
}

export async function cancelRunState(
  ctx: MutationCtx,
  run: Doc<"executionRuns">,
  requestedBy: string,
  reason: string,
  now: number,
): Promise<CancelRunStateResult> {
  const [analyticsCleanupDone, advisorCleanupDone] = await Promise.all([
    cancelAndCleanupForExecutionRun(ctx, run._id),
    cancelAdvisorForExecutionRun(ctx, run._id),
  ]);
  const domainCleanupDone = analyticsCleanupDone && advisorCleanupDone;
  await clearAudioGenerationForExecutionRun(ctx, run);
  await cancelVideoForExecutionRun(ctx, run._id);
  const activeAttempt = run.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
  if (activeAttempt?.componentOperationId) {
    const existing = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_operation", (q) => q
        .eq("adapterId", cancellationAdapter(activeAttempt.adapterId))
        .eq("operationId", activeAttempt.componentOperationId as string))
      .unique();
    if (!existing) {
      const refId = await ctx.db.insert("executionComponentRefs", {
        runId: run._id,
        attemptId: activeAttempt._id,
        userId: run.userId,
        adapterId: cancellationAdapter(activeAttempt.adapterId),
        operationId: activeAttempt.componentOperationId,
        role: "attempt-owned-component",
        status: "cancel_requested",
        createdAt: now,
        updatedAt: now,
      });
      // Ensure the insert participates in this transaction even though the
      // next bounded pass will discover the row by status.
      await ctx.db.get(refId);
    }
  }

  const bindings = await ctx.db
    .query("runtimeSessionBindings")
    .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", "active"))
    .take(RUN_CLEANUP_BATCH_SIZE);
  for (const binding of bindings) {
    await ctx.db.patch(binding._id, {
      status: "revoked",
      releasedAt: now,
      releaseReason: reason.slice(0, 500),
    });
  }

  const commands = (await Promise.all(
    (["pending", "acknowledged"] as const).map((status) => ctx.db
      .query("runtimeCommands")
      .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", status))
      .take(RUN_CLEANUP_BATCH_SIZE)),
  )).flat().slice(0, RUN_CLEANUP_BATCH_SIZE);
  for (const command of commands) {
    await ctx.db.patch(command._id, {
      status: "rejected",
      rejectionReason: "Execution cancelled",
      completedAt: now,
      updatedAt: now,
    });
  }

  const prepared = await ctx.db
    .query("executionOperations")
    .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", "prepared"))
    .take(RUN_CLEANUP_BATCH_SIZE);
  for (const operation of prepared) {
    await ctx.db.patch(operation._id, {
      status: "cancelled",
      errorSummary: "Cancelled before dispatch",
      completedAt: now,
      updatedAt: now,
    });
  }
  const dispatching = await ctx.db
    .query("executionOperations")
    .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", "dispatching"))
    .take(RUN_CLEANUP_BATCH_SIZE);
  for (const operation of dispatching) {
    await ctx.db.patch(operation._id, {
      status: "outcome_unknown",
      errorSummary: "Cancellation requested after dispatch; reconcile before retry",
      updatedAt: now,
    });
  }
  if (!["completed", "failed", "cancelled"].includes(run.state)) {
    await ctx.db.patch(run._id, {
      state: "cancelling",
      cancelRequestedAt: run.cancelRequestedAt ?? now,
      cancelRequestedBy: run.cancelRequestedBy ?? requestedBy,
      terminalSummary: reason.slice(0, 2_000),
      updatedAt: now,
    });
    if (activeAttempt && run.state !== "cancelling") {
      await appendRunEventUnchecked(ctx, run, {
        attemptId: activeAttempt._id,
        fence: activeAttempt.fence,
        type: "cancel_requested",
        summary: `Cancellation requested: ${reason}`,
        now,
      });
    }
  }
  const components = (await Promise.all(
    (["active", "cancel_requested"] as const).map((status) => ctx.db
      .query("executionComponentRefs")
      .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", status))
      .take(RUN_CLEANUP_BATCH_SIZE)),
  )).flat().slice(0, RUN_CLEANUP_BATCH_SIZE);
  const owned: OwnedComponent[] = [];
  for (const component of components) {
    if (component.status === "active" || component.status === "cancel_requested") {
      if (component.status === "active") {
        await ctx.db.patch(component._id, { status: "cancel_requested", updatedAt: now });
      }
      owned.push({
        componentRefId: component._id,
        operationId: component.operationId,
        adapterId: component.adapterId,
        cancelSafeAfter: component.cancelSafeAfter,
        cancelAcknowledgedAt: component.cancelAcknowledgedAt,
      });
    }
  }
  const localDone = bindings.length === 0
    && commands.length === 0
    && prepared.length === 0
    && dispatching.length === 0
    && domainCleanupDone;
  if (owned.length === 0 && localDone) {
    await finalizeRunCancellationIfSettled(ctx, run._id, now);
  }
  return { components: owned, localDone };
}
