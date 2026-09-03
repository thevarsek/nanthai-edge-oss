import type { WorkflowCtx } from "@convex-dev/workflow";
import { v } from "convex/values";
import { durableWorkflow } from "../execution/components";
import { internal } from "../_generated/api";
import {
  deferredVideoWorkflowArgsValidator,
  failToolVideoStepRef,
  pollToolVideoStepRef,
  submitToolVideoStepRef,
  toolVideoExecutionValidator,
  type ToolVideoExecution,
  VIDEO_GENERATION_MAX_POLL_COUNT,
} from "./video_generation_contract";

const FAST_POLL_COUNT = 4;
const FAST_POLL_INTERVAL_MS = 15_000;
const SLOW_POLL_INTERVAL_MS = 30_000;
type ToolVideoState = "pending" | "completed" | "failed" | "cancelled";

export const runToolVideoWorkflow = durableWorkflow
  .define({
    args: {
      ...deferredVideoWorkflowArgsValidator,
      execution: toolVideoExecutionValidator,
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    let state: Exclude<ToolVideoState, "pending">;
    let workflowError: unknown;
    let errorSummary: string | undefined;
    try {
      // The submit action owns a durable operation journal: a retry either
      // replays the recorded provider job or refuses an ambiguous dispatch.
      let providerState = await step.runAction(submitToolVideoStepRef, args, { retry: true });
      if (providerState === "pending") {
        for (let poll = 0; poll < VIDEO_GENERATION_MAX_POLL_COUNT; poll += 1) {
          if (poll > 0) {
            await step.sleep(poll < FAST_POLL_COUNT ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS);
          }
          providerState = await step.runAction(pollToolVideoStepRef, args, { retry: true });
          if (providerState !== "pending") break;
        }
      }
      if (providerState === "pending") {
        errorSummary = `Video generation timed out after ${VIDEO_GENERATION_MAX_POLL_COUNT} polls.`;
        await step.runAction(failToolVideoStepRef, { ...args, error: errorSummary }, { retry: true });
        state = "failed";
      } else {
        state = providerState;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.runAction(
        failToolVideoStepRef,
        { ...args, error: message },
        { retry: true },
      );
      state = "failed";
      workflowError = error;
      errorSummary = message;
    }

    // Keep execution bookkeeping outside the provider/domain catch. A
    // transient terminalization failure must never relabel completed or
    // cancelled media as failed.
    await terminalize(step, args.execution, state, errorSummary);
    if (workflowError) throw workflowError;
    return null;
  });

async function terminalize(
  step: WorkflowCtx,
  execution: ToolVideoExecution,
  state: Exclude<ToolVideoState, "pending">,
  error?: string,
): Promise<void> {
  await step.runMutation(internal.execution.mutations.terminalize, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    claimantId: execution.claimantId,
    outcome: state === "cancelled" ? "cancelled" : state === "completed" ? "completed" : "failed",
    summary: error ?? (state === "completed"
      ? "Tool-requested video generated and published"
      : state === "cancelled" ? "Tool-requested video cancelled" : "Tool-requested video failed"),
  });
}
