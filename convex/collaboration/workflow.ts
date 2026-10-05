import { decideLocalSpeakers } from "./local_scheduler";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { durableWorkflow } from "../execution/components";
import { failClosedProviderActionOptions } from
  "../execution/workflow_retry_policy";
import { collaborationExecutionRef } from "./validators";
import type { CollaborationExecutionRef } from "./validators";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { Id } from "../_generated/dataModel";
import { COLLABORATION_MAX_DURATION_MS } from "./constants";
import { DOMAIN_EXECUTION_LEASE_MS } from "../execution/domain_lifecycle";

export async function runCollaborationWorkflowHandler(
  step: WorkflowCtx,
  args: { exchangeId: Id<"collaborationExchanges">; execution: CollaborationExecutionRef },
): Promise<null> {
  for (let boundary = 0; boundary < 6; boundary += 1) {
    await step.runMutation(internal.execution.mutations.heartbeat, {
      attemptId: args.execution.attemptId,
      fence: args.execution.fence,
      claimantId: args.execution.claimantId,
      leaseMs: DOMAIN_EXECUTION_LEASE_MS,
    });
    const prepared = await step.runMutation(
      internal.collaboration.lifecycle_mutations.prepareWave,
      args,
    );
    if (prepared.kind === "terminal") return null;
    const cloud = await step.runQuery(internal.runtime_host.decision_helpers.hasCloudConnection, { runId: args.execution.runId });
    const schedulerResult = cloud ? await step.runAction(
      internal.collaboration.scheduler_action.decideSpeakers,
      {
        exchangeId: args.exchangeId,
        wave: prepared.wave,
      },
      failClosedProviderActionOptions,
    ) : await decideLocalSpeakers(step, {
      exchangeId: args.exchangeId, wave: prepared.wave,
      attemptId: args.execution.attemptId, fence: args.execution.fence,
    });
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
    if (persisted.silent) return null;
    await step.runMutation(
      internal.collaboration.dispatch_mutation.dispatchDecision,
      {
        exchangeId: args.exchangeId,
        decisionId: persisted.decisionId,
        execution: args.execution,
      },
    );
    let settled = false;
    for (let wait = 0; wait <= COLLABORATION_MAX_DURATION_MS / 1_000; wait += 1) {
      const barrier = await step.runQuery(
        internal.collaboration.barrier.getDecisionBarrier,
        {
          exchangeId: args.exchangeId,
          decisionId: persisted.decisionId,
        },
      );
      if (barrier.stale) throw new Error("COLLABORATION_BARRIER_STALE");
      if (barrier.terminal) {
        settled = true;
        break;
      }
      if (barrier.remainingMs <= 0) break;
      // Every wave spends the same persisted exchange budget, including human waits.
      await step.sleep(Math.min(1_000, barrier.remainingMs));
    }
    if (!settled) throw new Error("COLLABORATION_BARRIER_TIMEOUT");
    const result = await step.runMutation(
      internal.collaboration.settle_mutation.settleDecision,
      {
        exchangeId: args.exchangeId,
        decisionId: persisted.decisionId,
        execution: args.execution,
      },
    );
    if (result.terminal) return null;
  }
  throw new Error("COLLABORATION_WORKFLOW_BOUND_MISMATCH");
}

export const runCollaborationWorkflow = durableWorkflow.define({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    execution: collaborationExecutionRef,
  },
  returns: v.null(),
}).handler(runCollaborationWorkflowHandler);
