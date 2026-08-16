import { internal } from "../_generated/api";
import { v } from "convex/values";
import { durableWorkflow } from "../execution/components";
import { failClosedProviderActionOptions } from
  "../execution/workflow_retry_policy";
import { collaborationExecutionRef } from "./validators";

export const runCollaborationWorkflow = durableWorkflow
  .define({
    args: {
      exchangeId: v.id("collaborationExchanges"),
      execution: collaborationExecutionRef,
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    for (let boundary = 0; boundary < 6; boundary += 1) {
      await step.runMutation(internal.execution.mutations.heartbeat, {
        attemptId: args.execution.attemptId,
        fence: args.execution.fence,
        claimantId: args.execution.claimantId,
      });
      const prepared = await step.runMutation(
        internal.collaboration.lifecycle_mutations.prepareWave,
        args,
      );
      if (prepared.kind === "terminal") return null;
      const schedulerResult = await step.runAction(
        internal.collaboration.scheduler_action.decideSpeakers,
        {
          exchangeId: args.exchangeId,
          wave: prepared.wave,
        },
        failClosedProviderActionOptions,
      );
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
      for (let wait = 0; wait < 600; wait += 1) {
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
        await step.sleep(1_000);
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
  });
