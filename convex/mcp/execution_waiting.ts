import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { appendExecutionEvent } from "../execution/control_plane";
import {
  createAndClaimDomainExecution,
  linkDomainComponent,
  type DomainExecutionRef,
} from "../execution/domain_lifecycle";
import { assertCurrentExecution } from "../execution/attempts";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { scheduleOwnedWorkflowWatchdog } from "../execution/owned_workflow_watchdog";

type InvocationExecution = {
  _id: Id<"mcpInvocations">;
  userId: string;
  chatId?: Id<"chats">;
  messageId?: Id<"messages">;
  generationJobId?: Id<"generationJobs">;
  runId?: Id<"executionRuns">;
  durableRunId?: Id<"executionRuns">;
  durableAttemptId?: Id<"executionAttempts">;
  durableFence?: number;
  executionClaimantId?: string;
};

export async function executionForMcpInvocation(
  ctx: MutationCtx,
  invocation: InvocationExecution,
): Promise<DomainExecutionRef> {
  if (
    invocation.durableRunId
    && invocation.durableAttemptId
    && invocation.durableFence !== undefined
    && invocation.executionClaimantId
  ) {
    return {
      runId: invocation.durableRunId,
      attemptId: invocation.durableAttemptId,
      fence: invocation.durableFence,
      claimantId: invocation.executionClaimantId,
    };
  }
  const claimantId = `remote-mcp:${String(invocation._id)}`;
  const execution = await createAndClaimDomainExecution(ctx, {
    userId: invocation.userId,
    runKey: `remote-mcp:${String(invocation._id)}`,
    kind: "remote_mcp",
    domainType: "remote_mcp_invocation",
    domainId: String(invocation._id),
    claimantId,
    chatId: invocation.chatId,
    sourceMessageId: invocation.messageId,
    generationJobId: invocation.generationJobId,
    parentRunId: invocation.runId,
  });
  await ctx.db.patch(invocation._id, {
    durableRunId: execution.runId,
    durableAttemptId: execution.attemptId,
    durableFence: execution.fence,
    executionClaimantId: claimantId,
    updatedAt: Date.now(),
  });
  return execution;
}

export async function markMcpExecutionWaitingForInput(
  ctx: MutationCtx,
  execution: DomainExecutionRef,
): Promise<void> {
  const current = await assertCurrentExecution(ctx, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    claimantId: execution.claimantId,
    allowWaiting: true,
  });
  if (current.run._id !== execution.runId) throw new Error("MCP_TASK_EXECUTION_MISMATCH");
  if (current.attempt.status === "waiting" && current.run.state === "waiting_for_input") return;
  if (current.attempt.status !== "running") throw new Error("MCP_EXECUTION_NOT_RUNNING");

  const now = Date.now();
  // Append while the writer is still valid; the status transition below then
  // commits atomically with the event in the same mutation.
  await appendExecutionEvent(ctx, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    claimantId: execution.claimantId,
    type: "waiting_for_input",
    phase: "remote_mcp_input",
    summary: "Remote MCP server is waiting for user input",
    now,
  });
  await ctx.db.patch(current.attempt._id, {
    status: "waiting",
    leaseExpiresAt: undefined,
    updatedAt: now,
  });
  await ctx.db.patch(current.run._id, { state: "waiting_for_input", updatedAt: now });
}

export async function resumeMcpExecutionForInvocation(
  ctx: MutationCtx,
  invocation: InvocationExecution,
): Promise<boolean> {
  if (
    !invocation.durableRunId
    || !invocation.durableAttemptId
    || invocation.durableFence === undefined
    || !invocation.executionClaimantId
  ) return false;
  const current = await assertCurrentExecution(ctx, {
    attemptId: invocation.durableAttemptId,
    fence: invocation.durableFence,
    claimantId: invocation.executionClaimantId,
    allowWaiting: true,
  });
  if (current.run._id !== invocation.durableRunId) return false;
  if (current.attempt.status !== "running" && current.attempt.status !== "waiting") return false;

  const now = Date.now();
  if (current.attempt.status === "waiting") {
    await ctx.db.patch(current.attempt._id, {
      status: "running",
      heartbeatAt: now,
      leaseExpiresAt: now + 60 * 60 * 1_000,
      updatedAt: now,
    });
  }
  if (current.run.state === "waiting_for_input") {
    await ctx.db.patch(current.run._id, { state: "running", updatedAt: now });
  }
  return true;
}

export async function restoreMcpExecutionWaiting(
  ctx: MutationCtx,
  invocation: InvocationExecution,
): Promise<void> {
  if (
    !invocation.durableRunId
    || !invocation.durableAttemptId
    || invocation.durableFence === undefined
    || !invocation.executionClaimantId
  ) return;
  const current = await assertCurrentExecution(ctx, {
    attemptId: invocation.durableAttemptId,
    fence: invocation.durableFence,
    claimantId: invocation.executionClaimantId,
    allowWaiting: true,
  });
  if (current.run._id !== invocation.durableRunId) return;
  const now = Date.now();
  if (current.attempt.status === "running") {
    await ctx.db.patch(current.attempt._id, {
      status: "waiting",
      leaseExpiresAt: undefined,
      updatedAt: now,
    });
  }
  if (current.run.state === "running") {
    await ctx.db.patch(current.run._id, { state: "waiting_for_input", updatedAt: now });
  }
}

export async function startMcpTaskWorkflow(
  ctx: MutationCtx,
  invocation: { _id: Id<"mcpInvocations">; state: string; workflowId?: string },
  execution: DomainExecutionRef,
): Promise<void> {
  if (invocation.state !== "task_pending" || invocation.workflowId) return;
  const workflowId = String(await durableWorkflow.start(
    ctx,
    internal.mcp.task_workflow.runRemoteTaskWorkflow,
    { invocationId: invocation._id, execution },
    {
      startAsync: true,
      onComplete: ownedWorkflowCompletionRef,
      context: {},
    },
  ));
  await ctx.db.patch(execution.attemptId, {
    componentOperationId: workflowId,
    updatedAt: Date.now(),
  });
  await ctx.db.patch(invocation._id, { workflowId, updatedAt: Date.now() });
  await linkDomainComponent(ctx, execution, {
    adapterId: "convex-workflow",
    operationId: workflowId,
    role: "remote-mcp-task-workflow",
  });
  await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
}
