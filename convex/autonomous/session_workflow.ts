import { runLocalAutonomousTurn } from "./local_turn_execution";
import { localAutonomousDecision } from "./local_decisions";
import type { DiscussionOutcome } from "./decision_policy";
import { DOMAIN_EXECUTION_LEASE_MS } from "../execution/domain_lifecycle";
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
          leaseMs: DOMAIN_EXECUTION_LEASE_MS,
        });
        const route = await step.runQuery(internal.autonomous.local_turns.route, { sessionId: args.sessionId, participantIndex });
        const outcome = route === "local" ? await runLocalAutonomousTurn(step, { ...args, cycle, participantIndex }) : await step.runAction(
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
        leaseMs: DOMAIN_EXECUTION_LEASE_MS,
      });
      const latestSession = await step.runQuery(internal.autonomous.queries.getSession, { sessionId: args.sessionId });
      const cloud = latestSession?.executionRunId && await step.runQuery(internal.runtime_host.decision_helpers.hasCloudConnection, { runId: latestSession.executionRunId });
      const localJudgment = !cloud && latestSession?.status === "running" && latestSession.autoStopOnConsensus
        ? await localAutonomousDecision(step, { ...args, cycle }, latestSession, "discussion") : null;
      const cycleResult = await step.runAction(
        internal.autonomous.actions.finishAutonomousCycle,
        {
          sessionId: args.sessionId,
          cycle,
          userId: args.userId,
          executionEpoch: args.executionEpoch,
          ...(!cloud ? { localJudgment: (localJudgment ?? "continue") as DiscussionOutcome } : {}),
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
