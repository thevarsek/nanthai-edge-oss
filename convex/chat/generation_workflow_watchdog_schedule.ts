import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { GenerationParticipantWorkflowArgs } from "./workflow_contract";

export const GENERATION_WORKFLOW_WATCHDOG_INITIAL_MS = 11 * 60 * 1_000;
export const GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS = 30 * 60 * 1_000;

export async function scheduleGenerationWorkflowWatchdog(
  ctx: Pick<MutationCtx, "scheduler">,
  args: {
    workflowId: string;
    participantArgs: GenerationParticipantWorkflowArgs;
  },
  delayMs = GENERATION_WORKFLOW_WATCHDOG_INITIAL_MS,
): Promise<void> {
  await ctx.scheduler.runAfter(
    delayMs,
    internal.chat.workflow_events.reconcileGenerationWorkflowWatchdog,
    args,
  );
}
