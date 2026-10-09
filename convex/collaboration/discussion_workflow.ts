import { runConversationWorkflow } from "./conversation_workflow";
import { runLocalAutonomousTurn } from "../autonomous/local_turn_execution";
import { localAutonomousDecision } from "../autonomous/local_decisions";
import type { DiscussionOutcome } from "../autonomous/decision_policy";
import { DOMAIN_EXECUTION_LEASE_MS } from "../execution/domain_lifecycle";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import { failClosedProviderActionOptions } from "../execution/workflow_retry_policy";
import { runCycleArgs } from "../autonomous/actions_args";
import type { RunCycleArgs } from "../autonomous/actions_run_cycle_types";
import type { WorkflowCtx } from "@convex-dev/workflow";

export async function runDiscussionPolicy(step: WorkflowCtx, args: RunCycleArgs): Promise<null> {
  let cycle = args.cycle;
  let participantIndex = args.startParticipantIndex ?? 0;
  const failed = new Set<string>();
  return runConversationWorkflow(async () => {
    const session = await step.runQuery(internal.autonomous.queries.getSession, { sessionId: args.sessionId });
    if (!session || session.status !== "running" || session.executionEpoch !== args.executionEpoch
      || !args.executionAttemptId || args.executionFence === undefined) return "terminal";
    await step.runMutation(internal.execution.mutations.heartbeat, {
      attemptId: args.executionAttemptId, fence: args.executionFence,
      claimantId: session.executionClaimantId, leaseMs: DOMAIN_EXECUTION_LEASE_MS,
    });
    if (participantIndex < session.turnOrder.length) {
      const participantId = session.turnOrder[participantIndex];
      if (!failed.has(participantId)) {
        const current = await step.runQuery(internal.collaboration.discussion_configuration.resolveCurrent, args);
        const turnArgs = { ...args, ...current, cycle, participantIndex };
        const route = await step.runQuery(internal.autonomous.local_turns.route, { sessionId: args.sessionId, participantIndex });
        const outcome = route === "local" ? await runLocalAutonomousTurn(step, turnArgs) : await step.runAction(
          internal.autonomous.actions.runAutonomousTurn, turnArgs,
          failClosedProviderActionOptions,
        );
        if (outcome.kind === "terminal") return "terminal";
        if (outcome.kind === "failed") failed.add(participantId);
      }
      participantIndex += 1;
      if (session.pauseBetweenTurns > 0 && participantIndex < session.turnOrder.length) {
        await step.sleep(session.pauseBetweenTurns * 1_000);
      }
      return "continue";
    }
    const cloud = session.executionRunId && await step.runQuery(internal.runtime_host.decision_helpers.hasCloudConnection, { runId: session.executionRunId });
    const localJudgment = !cloud && session.autoStopOnConsensus
      ? await localAutonomousDecision(step, { ...args, cycle }, session, "discussion") : null;
    const result = await step.runAction(internal.autonomous.actions.finishAutonomousCycle, {
      sessionId: args.sessionId, cycle, userId: args.userId, executionEpoch: args.executionEpoch,
      ...(!cloud ? { localJudgment: (localJudgment ?? "continue") as DiscussionOutcome } : {}),
    }, failClosedProviderActionOptions);
    if (result === "terminal") return "terminal";
    if (failed.size >= session.turnOrder.length) {
      await step.runMutation(internal.autonomous.mutations.completeSession, {
        sessionId: args.sessionId, status: "failed", error: "All participants failed. Retry explicitly from the conversation.",
        executionEpoch: args.executionEpoch,
      });
      return "terminal";
    }
    cycle += 1; participantIndex = 0;
    return "continue";
  });
}
export const runDiscussionWorkflow = durableWorkflow.define({ args: runCycleArgs, returns: v.null() }).handler(runDiscussionPolicy);
