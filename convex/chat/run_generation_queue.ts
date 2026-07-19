import type { ActionCtx, MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { RunGenerationArgs } from "./actions_run_generation_types";

export async function enqueueRunGeneration(
  ctx: ActionCtx | MutationCtx,
  args: RunGenerationArgs,
): Promise<string> {
  const scheduledId = await ctx.scheduler.runAfter(
    0,
    internal.execution.queues.enqueueRunGeneration,
    args,
  );
  return String(scheduledId);
}
