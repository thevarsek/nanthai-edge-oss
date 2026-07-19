import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";

export const ADVISOR_BATCH_TERMINAL_EVENT = "advisor-batch-terminal";

export const runAdvisorBatchWorkflow = durableWorkflow
  .define({
    args: { batchId: v.id("advisorBatches") },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runMutation(
        internal.advisors.execution_lifecycle.heartbeatBatch,
        args,
      );
      const dispatched = await step.runMutation(
        internal.advisors.workflow_steps.dispatchAdvisorBatch,
        args,
      );
      if (!dispatched.terminal) {
        await step.awaitEvent({ name: ADVISOR_BATCH_TERMINAL_EVENT });
      }
      await step.runMutation(
        internal.advisors.execution_lifecycle.heartbeatBatch,
        args,
      );
      await step.runMutation(
        internal.advisors.workflow_steps.dispatchDeferredGeneration,
        args,
      );
      // Synthesis is part of this execution. The message finalizer closes the
      // parent only after every visible assistant response is terminal.
      return null;
    } catch (error) {
      await step.runMutation(
        internal.advisors.execution_lifecycle.terminalizeBatch,
        {
          ...args,
          outcome: "failed",
          summary: error instanceof Error ? error.message : String(error),
        },
      );
      throw error;
    }
  });
