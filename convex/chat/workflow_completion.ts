import { makeFunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { terminalizeAttempt } from "../execution/attempts";
import { finalizeGenerationHandler } from "./mutations_internal_handlers";
import { reconcileGenerationTerminalHooks } from "./generation_terminal_hooks";
import {
  latestGenerationRoundForWorkflow,
  type GenerationRoundPhase,
} from "./generation_round_journal";
import type { GenerationParticipantWorkflowArgs } from "./workflow_contract";
import { nextGenerationEventOffset } from "./generation_event_offset";
import { scheduleGenerationWorkflowWatchdog } from "./generation_workflow_watchdog_schedule";

const completionRef = makeFunctionReference<"mutation">(
  "chat/workflow_events:reconcileGenerationWorkflowCompletion",
);

const TERMINAL_GENERATION_STATUSES = new Set([
  "completed",
  "failed",
  "cancelled",
  "timedOut",
]);

type WorkflowResult =
  | { kind: "success"; returnValue?: unknown }
  | { kind: "failed"; error?: string }
  | { kind: "canceled" };

export type GenerationRecoveryDecision =
  | "recover_pre_dispatch"
  | "recover_checkpoint"
  | "fail_outcome_unknown"
  | "fail_without_checkpoint";

export function decideGenerationRecovery(
  phase: GenerationRoundPhase | undefined,
  hasContinuation: boolean,
  journalProtocolVersion?: 1,
): GenerationRecoveryDecision {
  if (phase === "dispatched" || phase === "outcome_unknown") {
    return "fail_outcome_unknown";
  }
  if (phase === "pre_dispatch") return "recover_pre_dispatch";
  if (phase === "committed") {
    return hasContinuation ? "recover_checkpoint" : "fail_without_checkpoint";
  }
  // Journal protocol v1 creates the round before the action, so no row proves
  // this Workflow made no provider call. Legacy workflows remain fail-closed.
  if (journalProtocolVersion === 1) return "recover_pre_dispatch";
  return "fail_outcome_unknown";
}

export function recoveryNextEventOffset(
  latestEventOffset: string | undefined,
  chainStartOffset: string | undefined,
): string {
  return latestEventOffset
    ? nextGenerationEventOffset(latestEventOffset)
    : chainStartOffset ?? "0";
}

type CompletionArgs = {
  workflowId: string;
  result: WorkflowResult;
  context: { participantArgs: GenerationParticipantWorkflowArgs };
};

type CompletionDeps = {
  startWorkflow: (
    ctx: MutationCtx,
    workflowArgs: GenerationParticipantWorkflowArgs,
  ) => Promise<string>;
  interruptAttempt: typeof terminalizeAttempt;
  failGeneration: typeof failInterruptedGeneration;
  scheduleWatchdog?: typeof scheduleGenerationWorkflowWatchdog;
};

const defaultDeps: CompletionDeps = {
  startWorkflow: async (
    ctx: MutationCtx,
    workflowArgs: GenerationParticipantWorkflowArgs,
  ): Promise<string> => String(await durableWorkflow.start(
    ctx,
    internal.chat.generation_workflow.runGenerationParticipantWorkflow,
    workflowArgs,
    {
      startAsync: true,
      onComplete: completionRef,
      context: { participantArgs: workflowArgs },
    },
  )),
  interruptAttempt: terminalizeAttempt,
  failGeneration: failInterruptedGeneration,
  scheduleWatchdog: scheduleGenerationWorkflowWatchdog,
};

async function failInterruptedGeneration(
  ctx: MutationCtx,
  args: CompletionArgs,
  summary: string,
): Promise<void> {
  const participantArgs = args.context.participantArgs;
  const job = await ctx.db.get(participantArgs.participant.jobId);
  if (!job || TERMINAL_GENERATION_STATUSES.has(job.status)) return;
  await finalizeGenerationHandler(ctx, {
    messageId: job.messageId,
    jobId: job._id,
    chatId: job.chatId,
    content: `Error: ${summary}`,
    status: "failed",
    error: summary,
    userId: job.userId,
    skipExecutionTerminalization: true,
  });
  await reconcileGenerationTerminalHooks(ctx, {
    assistantMessageIds: participantArgs.assistantMessageIds,
    generationJobIds: participantArgs.generationJobIds,
    chatId: participantArgs.chatId,
    userMessageId: participantArgs.userMessageId,
    userId: participantArgs.userId,
    searchSessionId: participantArgs.searchSessionId,
    subagentBatchId: participantArgs.subagentBatchId,
    drivePickerBatchId: participantArgs.drivePickerBatchId,
  });
}

export async function reconcileGenerationWorkflowCompletionHandler(
  ctx: MutationCtx,
  args: CompletionArgs,
  deps: CompletionDeps = defaultDeps,
): Promise<null> {
  const participantArgs = args.context.participantArgs;
  const job = await ctx.db.get(participantArgs.participant.jobId);
  const component = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_operation", (q) =>
      q.eq("adapterId", "convex-workflow").eq("operationId", args.workflowId),
    )
    .unique();
  if (!component) return null;
  if (component.status !== "active" && component.status !== "cancel_requested") {
    await ctx.scheduler.runAfter(
      60_000,
      internal.chat.workflow_events.cleanupGenerationWorkflow,
      { workflowId: args.workflowId },
    );
    return null;
  }
  const componentCompletedAt = Date.now();
  await ctx.db.patch(component._id, {
    status: args.result.kind === "success" ? "completed"
      : args.result.kind === "canceled" ? "cancel_requested" : "failed",
    terminalAt: args.result.kind === "canceled" ? undefined : componentCompletedAt,
    cancelSafeAfter: args.result.kind === "canceled"
      ? componentCompletedAt + 11 * 60 * 1_000
      : undefined,
    cancelAcknowledgedAt: args.result.kind === "canceled"
      ? componentCompletedAt
      : undefined,
    updatedAt: componentCompletedAt,
  });
  await ctx.scheduler.runAfter(
    args.result.kind === "canceled" ? 12 * 60 * 1_000 : 60_000,
    internal.chat.workflow_events.cleanupGenerationWorkflow,
    { workflowId: args.workflowId },
  );
  // Cancellation is an intentional terminal control-plane decision. Recovery
  // here can resurrect work the user just stopped or a chat deletion fenced.
  if (args.result.kind === "canceled") return null;
  if (!job || TERMINAL_GENERATION_STATUSES.has(job.status) || args.result.kind === "success") {
    return null;
  }
  if (!job.executionRunId || !job.executionAttemptId || job.executionFence === undefined) {
    return null;
  }
  const [continuation, latestRound] = await Promise.all([
    ctx.db
      .query("generationContinuations")
      .withIndex("by_job", (q) => q.eq("jobId", job._id))
      .first(),
    latestGenerationRoundForWorkflow(ctx, job._id, args.workflowId),
  ]);
  const decision = decideGenerationRecovery(
    latestRound?.phase,
    continuation !== null,
    participantArgs.journalProtocolVersion,
  );
  if (decision === "fail_outcome_unknown" && latestRound?.phase === "dispatched") {
    await ctx.db.patch(latestRound._id, {
      phase: "outcome_unknown",
      updatedAt: Date.now(),
    });
  }
  const attempt = await ctx.db.get(job.executionAttemptId);
  if (
    attempt
    && (decision === "fail_outcome_unknown" || decision === "fail_without_checkpoint")
    && ["running", "waiting", "interrupted"].includes(attempt.status)
  ) {
    await deps.interruptAttempt(ctx, {
      attemptId: attempt._id,
      fence: attempt.fence,
      outcome: "failed",
      summary: decision === "fail_outcome_unknown"
        ? "Provider round outcome is unknown"
        : "Generation Workflow has no recoverable checkpoint",
      allowExpiredLease: true,
      allowWaiting: true,
    });
  }
  if (decision === "fail_outcome_unknown") {
    await deps.failGeneration(
      ctx,
      args,
      "Generation was interrupted after provider dispatch; the round was not retried to avoid a duplicate response or charge.",
    );
    return null;
  }
  if (decision === "fail_without_checkpoint") {
    await deps.failGeneration(
      ctx,
      args,
      "Generation was interrupted before a durable round checkpoint.",
    );
    return null;
  }
  if (attempt && attempt.status === "running") {
    await deps.interruptAttempt(ctx, {
      attemptId: attempt._id,
      fence: attempt.fence,
      outcome: "interrupted",
      summary: "Generation Workflow was interrupted",
      allowExpiredLease: true,
    });
  }
  if (continuation) {
    await ctx.db.patch(continuation._id, {
      status: "waiting",
      claimedAt: undefined,
      leaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
  }
  const workflowArgs: GenerationParticipantWorkflowArgs = {
    ...participantArgs,
    resumeExpected: continuation !== null,
    executionAttemptId: job.executionAttemptId,
    executionFence: job.executionFence,
    durableChain: {
      nextEventOffset: recoveryNextEventOffset(
        latestRound?.eventOffset,
        participantArgs.durableChain?.nextEventOffset,
      ),
      resumeExpected: continuation !== null,
      ...(continuation?.deferredResumeEventId
        ? { rebindDeferredFromEventId: continuation.deferredResumeEventId }
        : {}),
    },
  };
  const workflowId = await deps.startWorkflow(ctx, workflowArgs);
  const now = Date.now();
  await ctx.db.insert("executionComponentRefs", {
    runId: job.executionRunId,
    attemptId: job.executionAttemptId,
    userId: job.userId,
    adapterId: "convex-workflow",
    operationId: workflowId,
    role: `generation-workflow-recovery:${args.workflowId}`,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  await deps.scheduleWatchdog?.(ctx, {
    workflowId,
    participantArgs: workflowArgs,
  });
  return null;
}
