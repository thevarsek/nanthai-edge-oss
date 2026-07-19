import type { WorkflowCtx } from "@convex-dev/workflow";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { researchSearchBatchTerminalEventName } from "./research_fanout_queries";

export async function awaitResearchSearchBatch(
  step: WorkflowCtx,
  batchId: Id<"researchSearchBatches">,
): Promise<void> {
  const batch = await step.runQuery(
    internal.search.research_fanout_queries.getResearchSearchBatch,
    { batchId },
  );
  if (batch?.status === "completed") return;

  await step.awaitEvent({
    name: researchSearchBatchTerminalEventName(String(batchId)),
  });
  const completedBatch = await step.runQuery(
    internal.search.research_fanout_queries.getResearchSearchBatch,
    { batchId },
  );
  if (completedBatch?.status !== "completed") {
    throw new Error("RESEARCH_SEARCH_BATCH_SIGNALLED_BEFORE_TERMINAL");
  }
}
