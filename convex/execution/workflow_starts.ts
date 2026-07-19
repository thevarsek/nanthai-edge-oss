import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { runCycleArgs } from "../autonomous/actions_args";
import { submitVideoGenerationArgs } from "../chat/actions_args";
import { researchPaperPipelineArgs } from "../search/workflow";
import { durableWorkflow } from "./components";
import { linkExecutionComponent } from "./component_refs";
import { claimExecutionRun } from "./attempts";
import { createExecutionRun } from "./runs";
import {
  createAndClaimDomainExecution,
  findDomainWorkflowOperation,
  linkDomainComponent,
} from "./domain_lifecycle";
import { shouldExecuteScheduledJob } from "../scheduledJobs/actions_execution_policy";
import { getScheduledJobSteps } from "../scheduledJobs/shared";
import type { Recurrence } from "../scheduledJobs/recurrence";
import { ownedWorkflowCompletionRef } from "./workflow_lifecycle";
import { ensureNextOccurrenceHandler } from "../scheduledJobs/workflow_schedule";
import { resolveScheduledOccurrenceStart } from "../scheduledJobs/occurrence";
import { scheduleOwnedWorkflowWatchdog } from "./owned_workflow_watchdog";

export const startAutonomous = internalMutation({
  args: runCycleArgs,
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("AUTONOMOUS_SESSION_NOT_FOUND");
    if (session.status !== "running" || session.userId !== args.userId) return null;
    const executionEpoch = (session.executionEpoch ?? 0) + 1;
    const runKey = [
      "autonomous",
      String(session._id),
      String(args.cycle),
      String(args.startParticipantIndex ?? 0),
      String(executionEpoch),
    ].join(":");
    const claimantId = `autonomous-workflow:${runKey}`;
    const existingWorkflowId = await findDomainWorkflowOperation(
      ctx,
      session.userId,
      runKey,
    );
    if (existingWorkflowId) return existingWorkflowId;
    const execution = await createAndClaimDomainExecution(ctx, {
      userId: session.userId,
      runKey,
      kind: "autonomous_chat",
      domainType: "autonomous_session",
      domainId: String(session._id),
      claimantId,
      chatId: session.chatId,
    });
    const attempt = await ctx.db.get(execution.attemptId);
    if (attempt?.componentOperationId) return attempt.componentOperationId;
    const workflowId = await durableWorkflow.start(
      ctx,
      internal.autonomous.session_workflow.runAutonomousSessionWorkflow,
      {
        ...args,
        executionAttemptId: execution.attemptId,
        executionFence: execution.fence,
        executionEpoch,
      },
      {
        startAsync: true,
        onComplete: ownedWorkflowCompletionRef,
        context: {},
      },
    );
    await ctx.db.patch(execution.attemptId, {
      componentOperationId: workflowId,
      updatedAt: Date.now(),
    });
    await linkDomainComponent(ctx, execution, {
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "autonomous-session-workflow",
    });
    await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
    await ctx.db.patch(args.sessionId, {
      workflowId,
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
      executionClaimantId: claimantId,
      executionEpoch,
    });
    return workflowId;
  },
});

export const startScheduledExecution = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    invocationSource: v.optional(
      v.union(v.literal("scheduled"), v.literal("manual"), v.literal("api")),
    ),
    templateVariables: v.optional(v.record(v.string(), v.string())),
    occurrenceId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const invocationSource = args.invocationSource ?? "scheduled";
    const occurrenceStart = resolveScheduledOccurrenceStart(job, args.occurrenceId);
    if (occurrenceStart.kind === "duplicate") return occurrenceStart.workflowId;
    if (occurrenceStart.kind === "overlap") {
      await ensureNextOccurrenceHandler(ctx, {
        jobId: job._id,
        occurrenceId: args.occurrenceId,
        invocationSource,
      });
      return null;
    }
    if (
      !shouldExecuteScheduledJob({
        status: job.status,
        recurrence: job.recurrence as Recurrence,
        invocationSource,
        isDeleting: job.isDeleting,
      })
    ) return null;
    const claimantId = `scheduled-workflow:${String(args.jobId)}:${args.occurrenceId}`;
    const runKey = `scheduled:${String(args.jobId)}:${args.occurrenceId}`;
    const executionId = `${String(args.jobId)}:${args.occurrenceId}`;
    const existingWorkflowId = await findDomainWorkflowOperation(ctx, job.userId, runKey);
    if (existingWorkflowId) return existingWorkflowId;
    const execution = await createAndClaimDomainExecution(ctx, {
      userId: job.userId,
      runKey,
      kind: "scheduled_job",
      domainType: "scheduled_job_occurrence",
      domainId: String(args.jobId),
      claimantId,
    });
    const attempt = await ctx.db.get(execution.attemptId);
    if (attempt?.componentOperationId) return attempt.componentOperationId;
    const workflowId = await durableWorkflow.start(
      ctx,
      internal.scheduledJobs.execution_workflow.runScheduledExecutionWorkflow,
      args,
      {
        startAsync: true,
        onComplete: ownedWorkflowCompletionRef,
        context: {
          scheduledOccurrence: {
            jobId: args.jobId,
            occurrenceId: args.occurrenceId,
            invocationSource,
          },
        },
      },
    );
    await ctx.db.patch(execution.attemptId, {
      componentOperationId: workflowId,
      updatedAt: Date.now(),
    });
    await linkDomainComponent(ctx, execution, {
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "scheduled-job-workflow",
    });
    await scheduleOwnedWorkflowWatchdog(ctx, {
      workflowId,
      context: {
        scheduledOccurrence: {
          jobId: args.jobId,
          occurrenceId: args.occurrenceId,
          invocationSource,
        },
      },
    });
    await ctx.db.patch(job._id, {
      activeExecutionId: executionId,
      activeOccurrenceId: args.occurrenceId,
      activeWorkflowId: workflowId,
      activeExecutionChatId: undefined,
      activeExecutionStartedAt: Date.now(),
      activeExecutionVariables: args.templateVariables,
      activeStepCount: getScheduledJobSteps(job).length,
      activeStepIndex: undefined,
      activeUserMessageId: undefined,
      activeAssistantMessageId: undefined,
      activeGenerationJobId: undefined,
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
      executionClaimantId: claimantId,
    });
    return workflowId;
  },
});

export const startResearchPaper = internalMutation({
  args: { ...researchPaperPipelineArgs, phaseOrder: v.optional(v.number()) },
  returns: v.string(),
  handler: async (ctx, rawArgs): Promise<string> => {
    const { phaseOrder: _phaseOrder, ...args } = rawArgs;
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error("RESEARCH_SESSION_NOT_FOUND");
    if (session.workflowId) return session.workflowId;
    const claimantId = `research-workflow:${String(args.sessionId)}`;
    const job = await ctx.db.get(args.jobId);
    const scheduledParent = job?.sourceJobId
      ? await ctx.db.get(job.sourceJobId)
      : null;
    const execution = await createAndClaimDomainExecution(ctx, {
      userId: args.userId,
      runKey: `research:${String(args.sessionId)}`,
      kind: "research",
      domainType: "search_session",
      domainId: String(args.sessionId),
      claimantId,
      chatId: args.chatId,
      sourceMessageId: args.assistantMessageId,
      generationJobId: args.jobId,
      parentRunId: job?.executionRunId ?? scheduledParent?.executionRunId,
    });
    const attempt = await ctx.db.get(execution.attemptId);
    if (attempt?.componentOperationId) return attempt.componentOperationId;
    const workflowId = await durableWorkflow.start(
      ctx,
      internal.search.research_workflow.runResearchPaperWorkflow,
      args,
      { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
    );
    await ctx.db.patch(execution.attemptId, {
      componentOperationId: workflowId,
      updatedAt: Date.now(),
    });
    await linkDomainComponent(ctx, execution, {
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "research-workflow",
    });
    await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
    await ctx.db.patch(session._id, {
      workflowId,
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
      executionClaimantId: claimantId,
    });
    return workflowId;
  },
});

export const startVideoGeneration = internalMutation({
  args: submitVideoGenerationArgs,
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const parent = await ctx.db.get(args.participant.jobId);
    const execution = await createExecutionRun(ctx, {
      userId: args.userId,
      runKey: `video:${String(args.participant.jobId)}`,
      kind: "media",
      requestedPlacement: "cloud",
      chatId: args.chatId,
      sourceMessageId: args.userMessageId,
      generationJobId: args.participant.jobId,
      domainType: "video_generation",
      domainId: String(args.participant.messageId),
      parentRunId: parent?.executionRunId,
      initialAttempt: {
        executorKind: "convex_workflow",
        placement: "cloud",
        adapterId: "convex-workflow",
        provider: "openrouter",
        modelId: args.participant.modelId,
      },
    });
    const existingAttempt = await ctx.db.get(execution.attemptId);
    if (existingAttempt?.componentOperationId) return existingAttempt.componentOperationId;
    const claimantId = `video-workflow:${String(args.participant.jobId)}`;
    const claimed = await claimExecutionRun(ctx, {
      runId: execution.runId,
      claimantId,
      leaseMs: 20 * 60 * 1000,
    });
    if (!claimed) throw new Error("VIDEO_EXECUTION_NOT_CLAIMABLE");
    const workflowId = await durableWorkflow.start(
      ctx,
      internal.chat.video_workflow.runVideoGenerationWorkflow,
      {
        ...args,
        execution: {
          runId: claimed.runId,
          attemptId: claimed.attemptId,
          fence: claimed.fence,
          claimantId,
        },
      },
      { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
    );
    await ctx.db.patch(claimed.attemptId, {
      componentOperationId: workflowId,
      updatedAt: Date.now(),
    });
    await linkExecutionComponent(ctx, {
      runId: claimed.runId,
      attemptId: claimed.attemptId,
      fence: claimed.fence,
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "video-generation-workflow",
    });
    await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
    return workflowId;
  },
});
