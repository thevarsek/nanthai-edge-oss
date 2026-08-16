import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { durableWorkflow } from "../execution/components";
import {
  createAndClaimDomainExecution,
  findDomainWorkflowOperation,
  linkDomainComponent,
} from "../execution/domain_lifecycle";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { scheduleOwnedWorkflowWatchdog } from
  "../execution/owned_workflow_watchdog";

export const startExchange = internalMutation({
  args: { exchangeId: v.id("collaborationExchanges") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange || exchange.status !== "queued") return null;
    const runKey = `collaboration:${String(exchange._id)}`;
    const existingWorkflowId = await findDomainWorkflowOperation(
      ctx,
      exchange.userId,
      runKey,
    );
    if (existingWorkflowId) return existingWorkflowId;
    const claimantId = `collaboration-workflow:${String(exchange._id)}`;
    const execution = await createAndClaimDomainExecution(ctx, {
      userId: exchange.userId,
      runKey,
      kind: "collaboration",
      domainType: "collaboration_exchange",
      domainId: String(exchange._id),
      claimantId,
      chatId: exchange.chatId,
      sourceMessageId: exchange.initiatingMessageId,
    });
    const workflowId = await durableWorkflow.start(
      ctx,
      internal.collaboration.workflow.runCollaborationWorkflow,
      {
        exchangeId: exchange._id,
        execution,
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
      role: "collaboration-wave-workflow",
    });
    await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
    const now = Date.now();
    await ctx.db.patch(exchange._id, {
      workflowId,
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
      executionClaimantId: claimantId,
      startedAt: now,
      updatedAt: now,
    });
    return workflowId;
  },
});
