import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import { failClosedProviderActionOptions } from
  "../execution/workflow_retry_policy";
import { runCycleArgs } from "./actions_args";

export const runAutonomousSessionWorkflow = durableWorkflow
  .define({ args: runCycleArgs, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    let cycle = args.cycle;
    let startParticipantIndex = args.startParticipantIndex;
    for (let invocation = 0; invocation < 4_096; invocation += 1) {
      const session = await step.runQuery(
        internal.autonomous.queries.getSession,
        {
          sessionId: args.sessionId,
        },
      );
      if (!session || session.status !== "running") {
        return null;
      }
      if (args.executionEpoch === undefined || session.executionEpoch !== args.executionEpoch) {
        return null;
      }
      const participantCount = session.turnOrder.length;
      for (
        let participantIndex = startParticipantIndex ?? 0;
        participantIndex < participantCount;
        participantIndex += 1
      ) {
        if (!args.executionAttemptId || args.executionFence === undefined) return null;
        await step.runMutation(internal.execution.mutations.heartbeat, {
          attemptId: args.executionAttemptId,
          fence: args.executionFence,
          claimantId: session.executionClaimantId,
        });
        const outcome = await step.runAction(
          internal.autonomous.actions.runAutonomousTurn,
          { ...args, cycle, participantIndex },
          // A turn crosses the provider boundary before its final message is
          // durably committed. Replaying an ambiguous failure can duplicate a
          // paid model call, so the Workflow must fail closed here.
          failClosedProviderActionOptions,
        );
        if (outcome.kind === "terminal") return null;
        if (
          session.pauseBetweenTurns > 0 &&
          participantIndex < participantCount - 1
        ) {
          await step.sleep(session.pauseBetweenTurns * 1_000);
        }
      }
      if (!args.executionAttemptId || args.executionFence === undefined) return null;
      await step.runMutation(internal.execution.mutations.heartbeat, {
        attemptId: args.executionAttemptId,
        fence: args.executionFence,
        claimantId: session.executionClaimantId,
      });
      const cycleResult = await step.runAction(
        internal.autonomous.actions.finishAutonomousCycle,
        {
          sessionId: args.sessionId,
          cycle,
          userId: args.userId,
          executionEpoch: args.executionEpoch,
        },
        // Consensus detection is also a paid provider call. The next cycle is
        // only safe after this action returns unambiguously.
        failClosedProviderActionOptions,
      );
      if (cycleResult === "terminal") return null;
      cycle += 1;
      startParticipantIndex = 0;
    }
    throw new Error("AUTONOMOUS_WORKFLOW_INVOCATION_LIMIT");
  });
