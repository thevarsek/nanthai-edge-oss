import { runConversationWorkflow } from "./conversation_workflow";
import { decideLocalSpeakers } from "./local_scheduler";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { durableWorkflow } from "../execution/components";
import { failClosedProviderActionOptions } from
  "../execution/workflow_retry_policy";
import { collaborationExecutionRef } from "./validators";
import type { CollaborationExecutionRef } from "./validators";
import type { EventId, WorkflowCtx } from "@convex-dev/workflow";
import type { Id } from "../_generated/dataModel";
import { DOMAIN_EXECUTION_LEASE_MS } from "../execution/domain_lifecycle";

export async function runCollaborationWorkflowHandler(
  step: WorkflowCtx,
  args: { exchangeId: Id<"collaborationExchanges">; execution: CollaborationExecutionRef },
): Promise<null> {
  return runConversationWorkflow(async () => {
    await step.runMutation(internal.execution.mutations.heartbeat, {
      attemptId: args.execution.attemptId,
      fence: args.execution.fence,
      claimantId: args.execution.claimantId,
      leaseMs: DOMAIN_EXECUTION_LEASE_MS,
    });
    const eventId = await step.runMutation(internal.collaboration.wake_events.armWake, args);
    const progress = await step.runMutation(internal.collaboration.work_progress.observeProgress, args);
    if (progress.kind === "terminal") return "terminal";
    if (progress.kind === "wait") {
      await step.awaitEvent({ id: eventId as EventId<string>, validator: v.string() });
      return "continue";
    }
    if (progress.kind === "settle") {
      const settled = await step.runMutation(internal.collaboration.settle_mutation.settleDecision, {
        ...args, decisionId: progress.decisionId,
      });
      if (settled.terminal) return "terminal";
    }
    const prepared = await step.runMutation(
      internal.collaboration.lifecycle_mutations.prepareWave,
      args,
    );
    if (prepared.kind === "terminal") return "terminal";
    const cloud = await step.runQuery(internal.runtime_host.decision_helpers.hasCloudConnection, { runId: args.execution.runId });
    const workSelection = await step.runMutation(internal.collaboration.work_progress.selectWorkSpeakers, args);
    const schedulerResult = workSelection ?? (cloud ? await step.runAction(
      internal.collaboration.scheduler_action.decideSpeakers,
      {
        exchangeId: args.exchangeId,
        wave: prepared.wave,
      },
      failClosedProviderActionOptions,
    ) : await decideLocalSpeakers(step, {
      exchangeId: args.exchangeId, wave: prepared.wave,
      attemptId: args.execution.attemptId, fence: args.execution.fence,
    }));
    const persisted = await step.runMutation(
      internal.collaboration.lifecycle_mutations.persistDecision,
      {
        exchangeId: args.exchangeId,
        wave: prepared.wave,
        frontierMessageIds: prepared.frontierMessageIds,
        ...schedulerResult,
        execution: args.execution,
      },
    );
    if (persisted.silent) return "terminal";
    if (persisted.waiting) {
      await step.awaitEvent({ id: eventId as EventId<string>, validator: v.string() });
      return "continue";
    }
    await step.runMutation(
      internal.collaboration.dispatch_mutation.dispatchDecision,
      {
        exchangeId: args.exchangeId,
        decisionId: persisted.decisionId,
        execution: args.execution,
      },
    );
    return "continue";
  });
}

export const runCollaborationWorkflow = durableWorkflow.define({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    execution: collaborationExecutionRef,
  },
  returns: v.null(),
}).handler(runCollaborationWorkflowHandler);
