"use node";

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { continueDurableParentAfterSubagents } from "./durable_parent_resume";

export async function continueParentAfterSubagentsHandler(
  ctx: ActionCtx,
  args: { batchId: Id<"subagentBatches"> },
): Promise<void> {
  const resumed = await continueDurableParentAfterSubagents(ctx, args.batchId);
  if (!resumed) {
    throw new Error("SUBAGENT_PARENT_WORKFLOW_EVENT_REQUIRED");
  }
}
