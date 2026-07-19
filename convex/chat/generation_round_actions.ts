import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { RunGenerationParticipantArgs } from "./generation_continuation_shared";

export async function transitionGenerationRound(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  phase: "dispatched" | "committed",
): Promise<void> {
  if (!args.workflowResumeEventId) return;
  const ref = phase === "dispatched"
    ? internal.chat.generation_round_journal.markDispatched
    : internal.chat.generation_round_journal.markCommitted;
  const changed = await ctx.runMutation(ref, {
    jobId: args.participant.jobId,
    userId: args.userId,
    roundKey: args.workflowResumeEventId,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });
  if (!changed) throw new Error(`GENERATION_ROUND_${phase.toUpperCase()}_REJECTED`);
}
