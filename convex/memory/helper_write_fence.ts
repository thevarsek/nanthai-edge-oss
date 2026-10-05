import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";

export interface MemoryHelperExecution {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
}

export async function assertMemoryHelperExecution(ctx: MutationCtx, args: MemoryHelperExecution, userId: string): Promise<void> {
  if (!args.executionAttemptId && args.executionFence === undefined) return;
  if (!args.executionAttemptId || args.executionFence === undefined) throw new Error("LOCAL_HELPER_FENCE_REQUIRED");
  const { run } = await assertCurrentExecution(ctx, { attemptId: args.executionAttemptId, fence: args.executionFence, allowWaiting: true });
  if (run.userId !== userId || run.domainType !== "local_helper") throw new Error("LOCAL_HELPER_OWNER_MISMATCH");
}
