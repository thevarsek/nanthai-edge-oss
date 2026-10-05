import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { RunCycleArgs } from "./actions_run_cycle_types";
import { localAutonomousDecision } from "./local_decisions";

export async function runLocalAutonomousTurn(step: WorkflowCtx, args: RunCycleArgs & { participantIndex: number }) {
  const checkpointArgs = { sessionId: args.sessionId, cycle: args.cycle, participantIndex: args.participantIndex, executionEpoch: args.executionEpoch };
  const recovered = await step.runMutation(internal.autonomous.turn_checkpoint.recoverTurn, checkpointArgs);
  if (recovered !== "execute") return { kind: recovered };
  const session = await step.runQuery(internal.autonomous.queries.getSession, { sessionId: args.sessionId });
  if (!session || session.status !== "running") return { kind: "terminal" as const };
  await step.runMutation(internal.autonomous.mutations.updateProgress, { sessionId: args.sessionId, currentCycle: args.cycle, currentParticipantIndex: args.participantIndex, executionEpoch: args.executionEpoch });
  let moderatorDirective: string | undefined;
  if (args.moderatorConfig) {
    const cloud = session.executionRunId && await step.runQuery(internal.runtime_host.decision_helpers.hasCloudConnection, { runId: session.executionRunId });
    const directive = cloud
      ? await step.runAction(internal.autonomous.local_moderator.generate, { ...args, participantIndex: args.participantIndex }, { retry: false })
      : await localAutonomousDecision(step, args, session, "moderator", args.participantIndex);
    moderatorDirective = directive ?? undefined;
  }
  const turn = await step.runMutation(internal.autonomous.local_turns.createTurn, { ...args, moderatorDirective });
  if (!turn) return { kind: "terminal" as const };
  await step.runWorkflow(internal.autonomous.local_turn_workflow.run, turn);
  const outcome = await step.runQuery(internal.autonomous.local_turns.outcome, { jobId: turn.participant.jobId });
  await step.runMutation(internal.autonomous.turn_checkpoint.settle, {
    ...checkpointArgs, outcome, ...(outcome === "completed" ? { messageId: turn.participant.messageId } : {}),
  });
  return { kind: outcome };
}
