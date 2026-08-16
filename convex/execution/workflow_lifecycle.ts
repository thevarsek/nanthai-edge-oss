import { vResultValidator } from "@convex-dev/workflow";
import { makeFunctionReference } from "convex/server";
import { type Infer, v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { terminalizeAttempt } from "./attempts";
import { completeDeferredToolHandler } from "../chat/workflow_resume_handlers";
import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers";
import { ensureNextOccurrenceHandler } from "../scheduledJobs/workflow_schedule";
import { terminalizeExecution } from "./control_plane";
import { reconcileAutonomousSessionWorkflowFailure } from
  "../autonomous/execution_lifecycle";
import { requestRunTreeTeardown } from "./teardown_graph";

export const ownedWorkflowContextValidator = v.object({
  scheduledOccurrence: v.optional(v.object({
    jobId: v.id("scheduledJobs"),
    occurrenceId: v.string(),
    invocationSource: v.union(
      v.literal("scheduled"),
      v.literal("manual"),
      v.literal("api"),
    ),
  })),
});

export type OwnedWorkflowContext = Infer<typeof ownedWorkflowContextValidator>;
export const ownedWorkflowCompletionRef = makeFunctionReference<"mutation">(
  "execution/workflow_lifecycle:reconcileOwnedWorkflow",
);
const cleanupOwnedWorkflowRef = makeFunctionReference<"mutation">(
  "execution/owned_workflow_cleanup:cleanupOwnedWorkflow",
);

async function reconcileDomainAfterWorkflowFailure(
  ctx: Parameters<typeof terminalizeAttempt>[0],
  run: Doc<"executionRuns">,
  cancelled: boolean,
  summary: string,
  now: number,
): Promise<void> {
  if (!run.domainId) return;
  if (run.domainType === "advisor_batch") {
    const batch = await ctx.db.get(run.domainId as Id<"advisorBatches">);
    if (batch && !["completed", "failed", "cancelled"].includes(batch.status)) {
      for (const messageId of batch.assistantMessageIds) {
        const jobs = await ctx.db
          .query("generationJobs")
          .withIndex("by_message", (query) => query.eq("messageId", messageId))
          .collect();
        for (const job of jobs) {
          if (!["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
            await finalizeGenerationHandler(ctx, {
              messageId,
              jobId: job._id,
              chatId: batch.chatId,
              content: cancelled ? "[Generation cancelled]" : `Error: ${summary}`,
              status: cancelled ? "cancelled" : "failed",
              error: summary,
              userId: batch.userId,
            });
          }
        }
      }
      await ctx.db.patch(batch._id, {
        status: cancelled ? "cancelled" : "failed",
        updatedAt: now,
      });
    }
  } else if (run.domainType === "autonomous_session") {
    const session = await ctx.db.get(run.domainId as Id<"autonomousSessions">);
    if (session) {
      await reconcileAutonomousSessionWorkflowFailure(ctx, session, {
        cancelled,
        summary,
        now,
      });
    }
  } else if (run.domainType === "collaboration_exchange") {
    const exchange = await ctx.db.get(
      run.domainId as Id<"collaborationExchanges">,
    );
    if (
      exchange &&
      !["silent", "completed", "limit_reached", "stopped", "failed"].includes(
        exchange.status,
      )
    ) {
      await ctx.db.patch(exchange._id, {
        status: cancelled ? "stopped" : "failed",
        activeParticipantIds: [],
        terminalReason: cancelled
          ? "workflow_cancelled"
          : "scheduler_or_control_plane_failure",
        error: cancelled ? undefined : summary.slice(0, 2_000),
        completedAt: now,
        updatedAt: now,
      });
    }
    if (!cancelled) {
      const childRuns = await ctx.db
        .query("executionRuns")
        .withIndex("by_parent", (query) => query.eq("parentRunId", run._id))
        .collect();
      for (const childRun of childRuns) {
        if (["completed", "failed", "cancelled"].includes(childRun.state)) continue;
        await requestRunTreeTeardown(
          ctx,
          childRun._id,
          run.userId,
          "Collaboration coordinator failed",
        );
        await ctx.scheduler.runAfter(
          0,
          internal.execution.teardown.cancelRunTree,
          {
            runId: childRun._id,
            requestedBy: run.userId,
            reason: "Collaboration coordinator failed",
          },
        );
      }
    }
  } else if (run.domainType === "search_session") {
    const session = await ctx.db.get(run.domainId as Id<"searchSessions">);
    if (session && !["completed", "failed", "cancelled"].includes(session.status)) {
      await ctx.db.patch(session._id, {
        status: cancelled ? "cancelled" : "failed",
        currentPhase: cancelled ? "cancelled" : "failed",
        errorMessage: cancelled ? undefined : summary,
        completedAt: now,
      });
    }
  } else if (run.domainType === "analytics_tool") {
    const analytics = await ctx.db
      .query("analyticsWorkflowRuns")
      .withIndex("by_execution_run", (q) => q.eq("executionRunId", run._id))
      .unique();
    if (analytics) {
      if (!["completed", "failed", "cancelled"].includes(analytics.status)) {
        await ctx.db.patch(analytics._id, {
          status: cancelled ? "cancelled" : "failed",
          phase: cancelled ? "cancelled" : "failed",
          error: cancelled ? undefined : summary,
          completedAt: now,
          updatedAt: now,
        });
      }
      if (analytics.parentEventId) {
        await completeDeferredToolHandler(ctx, {
          jobId: analytics.jobId,
          userId: analytics.userId,
          toolCallId: analytics.toolCallId,
          toolName: analytics.toolName,
          result: JSON.stringify({ error: summary }),
          isError: true,
          eventId: analytics.parentEventId,
        });
      }
    }
  } else if (run.domainType === "presentation") {
    const project = await ctx.db.get(run.domainId as Id<"presentationProjects">);
    if (project) {
      if (project.status !== "ready" && project.status !== "failed") {
        await ctx.db.patch(project._id, {
          status: "failed",
          workflowPhase: "failed",
          error: cancelled ? "Presentation generation cancelled" : summary,
          updatedAt: now,
        });
      }
      if (
        run.generationJobId
        && project.originToolCallId
        && project.parentResumeEventId
      ) {
        await completeDeferredToolHandler(ctx, {
          jobId: run.generationJobId,
          userId: project.userId,
          toolCallId: project.originToolCallId,
          toolName: "create_presentation",
          result: JSON.stringify({ error: summary }),
          isError: true,
          eventId: project.parentResumeEventId,
        });
      }
    }
  } else if (run.domainType === "scheduled_job_occurrence") {
    const job = await ctx.db.get(run.domainId as Id<"scheduledJobs">);
    if (job?.executionRunId === run._id) {
      await ctx.db.patch(job._id, {
        activeExecutionId: undefined,
        activeOccurrenceId: undefined,
        activeWorkflowId: undefined,
        activeExecutionChatId: undefined,
        activeExecutionStartedAt: undefined,
        activeExecutionVariables: undefined,
        activeStepIndex: undefined,
        activeStepCount: undefined,
        activeUserMessageId: undefined,
        activeAssistantMessageId: undefined,
        activeGenerationJobId: undefined,
        lastRunStatus: "failed",
        lastRunError: cancelled ? "Execution cancelled" : summary,
        updatedAt: now,
      });
    }
  } else if (run.domainType === "secret_crypto_rotation") {
    const rotation = await ctx.db.get(run.domainId as Id<"secretCryptoRotations">);
    if (rotation && !["completed", "failed", "cancelled"].includes(rotation.status)) {
      await ctx.db.patch(rotation._id, {
        status: cancelled ? "cancelled" : "failed",
        lastSafeErrorCode: cancelled
          ? "SECRET_ROTATION_CANCELLED"
          : "SECRET_ROTATION_FAILED",
        completedAt: now,
        updatedAt: now,
      });
    }
  } else if (run.domainType === "remote_mcp_invocation") {
    const invocation = await ctx.db.get(run.domainId as Id<"mcpInvocations">);
    if (invocation && !["completed", "failed", "cancelled"].includes(invocation.state)) {
      await ctx.db.patch(invocation._id, {
        state: cancelled ? "cancelled" : "failed",
        errorCode: cancelled ? "MCP_CANCELLED" : "MCP_WORKFLOW_FAILED",
        completedAt: now,
        updatedAt: now,
      });
      if (
        invocation.generationJobId
        && invocation.toolCallId
        && invocation.parentResumeEventId
      ) {
        await completeDeferredToolHandler(ctx, {
          jobId: invocation.generationJobId,
          userId: invocation.userId,
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolAlias ?? "remote_mcp",
          result: JSON.stringify({ error: summary }),
          isError: true,
          eventId: invocation.parentResumeEventId,
        });
      }
    }
  }

  if (
    run.generationJobId
    && ["video_generation", "search_session"].includes(run.domainType ?? "")
  ) {
    const job = await ctx.db.get(run.generationJobId);
    if (job && !["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
      await finalizeGenerationHandler(ctx, {
        messageId: job.messageId,
        jobId: job._id,
        chatId: job.chatId,
        content: cancelled ? "[Generation cancelled]" : `Error: ${summary}`,
        status: cancelled ? "cancelled" : "failed",
        error: summary,
        userId: job.userId,
        skipExecutionTerminalization: true,
      });
    }
    if (run.parentRunId) {
      const parentRun = await ctx.db.get(run.parentRunId);
      const parentAttempt = parentRun?.activeAttemptId
        ? await ctx.db.get(parentRun.activeAttemptId)
        : null;
      if (
        parentRun
        && parentAttempt
        && !["completed", "failed", "cancelled"].includes(parentRun.state)
      ) {
        const parentOutcome = cancelled || parentRun.state === "cancelling"
          ? "cancelled"
          : "failed";
        await terminalizeExecution(ctx, {
          attemptId: parentAttempt._id,
          fence: parentAttempt.fence,
          outcome: parentOutcome,
          summary,
          allowExpiredLease: true,
          allowWaiting: true,
        });
      }
    }
  }
}

export async function reconcileOwnedWorkflowHandler(
  ctx: MutationCtx,
  args: {
    workflowId: string;
    result: Infer<typeof vResultValidator>;
    context: OwnedWorkflowContext;
  },
): Promise<null> {
  const ref = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_operation", (q) =>
      q.eq("adapterId", "convex-workflow").eq("operationId", args.workflowId),
    )
    .unique();
  const now = Date.now();
  if (args.result.kind !== "success" && args.context.scheduledOccurrence) {
    await ensureNextOccurrenceHandler(ctx, args.context.scheduledOccurrence);
  }
  if (ref && (ref.status === "active" || ref.status === "cancel_requested")) {
    await ctx.db.patch(ref._id, {
      status: args.result.kind === "success"
        ? "completed"
        : args.result.kind === "canceled"
          ? "cancel_requested"
          : "failed",
      terminalAt: args.result.kind === "canceled" ? undefined : now,
      cancelSafeAfter: args.result.kind === "canceled"
        ? ref.cancelSafeAfter ?? now + 11 * 60 * 1_000
        : undefined,
      cancelAcknowledgedAt: args.result.kind === "canceled"
        ? ref.cancelAcknowledgedAt ?? now
        : undefined,
      updatedAt: now,
    });
    // A canceled component is not physically quiescent yet. Only the common
    // teardown reconciler may terminalize cancellation after all refs drain.
    if (args.result.kind === "failed" && ref.attemptId) {
      const attempt = await ctx.db.get(ref.attemptId);
      const run = attempt ? await ctx.db.get(attempt.runId) : null;
      if (
        attempt
        && run
        && run.activeAttemptId === attempt._id
        && !["completed", "failed", "cancelled"].includes(run.state)
        && !["completed", "failed", "cancelled", "superseded"].includes(attempt.status)
      ) {
        const terminal = await terminalizeAttempt(ctx, {
          attemptId: attempt._id,
          fence: attempt.fence,
          outcome: "failed",
          summary: args.result.kind === "failed"
            ? `Workflow interrupted: ${args.result.error}`
            : "Workflow cancelled",
          now,
          allowExpiredLease: true,
          allowWaiting: true,
        });
        if (terminal.changed || run.terminalOutcome === terminal.outcome) {
          await reconcileDomainAfterWorkflowFailure(
            ctx,
            run,
            false,
            args.result.kind === "failed"
              ? `Workflow interrupted: ${args.result.error}`
              : "Workflow cancelled",
            now,
          );
        }
      }
    }
  }
  await ctx.scheduler.runAfter(
    60_000,
    cleanupOwnedWorkflowRef,
    { workflowId: args.workflowId },
  );
  return null;
}

export const reconcileOwnedWorkflow = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: ownedWorkflowContextValidator,
  },
  returns: v.null(),
  handler: reconcileOwnedWorkflowHandler,
});
