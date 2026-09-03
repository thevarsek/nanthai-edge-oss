import type { WorkflowCtx } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { durableWorkflow } from "../execution/components";
import { failClosedProviderActionOptions } from
  "../execution/workflow_retry_policy";
import {
  generateAudioForMessageArgs,
  messageAudioExecutionValidator,
} from "./actions_args";

export const runMessageAudioWorkflow = durableWorkflow
  .define({
    args: {
      ...generateAudioForMessageArgs,
      execution: messageAudioExecutionValidator,
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    try {
      await step.runMutation(internal.execution.mutations.heartbeat, {
        attemptId: args.execution.attemptId,
        fence: args.execution.fence,
        claimantId: args.execution.claimantId,
        leaseMs: 20 * 60 * 1_000,
      });
      await step.runAction(
        internal.chat.actions.generateAudioForMessage,
        args,
        failClosedProviderActionOptions,
      );
      await terminalize(step, args.execution, "completed");
      return null;
    } catch (error) {
      await terminalize(step, args.execution, "failed", error)
        .catch(() => undefined);
      throw error;
    }
  });

async function terminalize(
  step: WorkflowCtx,
  execution: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId: string;
  },
  outcome: "completed" | "failed",
  error?: unknown,
): Promise<void> {
  await step.runMutation(internal.execution.mutations.terminalize, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    claimantId: execution.claimantId,
    outcome,
    summary: error instanceof Error
      ? error.message
      : outcome === "completed"
        ? "Message audio generated and published"
        : "Message audio generation failed",
  });
}
