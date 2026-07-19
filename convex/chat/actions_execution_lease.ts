import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RunGenerationParticipantArgs } from "./generation_continuation_shared";

export async function claimParticipantExecution(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
): Promise<RunGenerationParticipantArgs | null> {
  if (!args.executionAttemptId || args.executionFence === undefined) {
    return args;
  }
  const claim = await ctx.runMutation(internal.execution.mutations.claimGeneration, {
    jobId: args.participant.jobId,
    claimantId: crypto.randomUUID(),
    expectedAttemptId: args.executionAttemptId,
    expectedFence: args.executionFence,
  });
  if (!claim) return null;
  return {
    ...args,
    executionAttemptId: claim.attemptId,
    executionFence: claim.fence,
  };
}
