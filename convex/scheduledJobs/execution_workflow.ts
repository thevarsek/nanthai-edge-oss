import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";

export function scheduledStepEventName(stepIndex: number): string {
  return `scheduled-step-${stepIndex}-terminal`;
}

const stepResultValidator = v.object({
  status: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
  assistantMessageId: v.id("messages"),
  error: v.optional(v.string()),
});

export const runScheduledExecutionWorkflow = durableWorkflow
  .define({
    args: {
      jobId: v.id("scheduledJobs"),
      invocationSource: v.optional(v.union(
        v.literal("scheduled"),
        v.literal("manual"),
        v.literal("api"),
      )),
      templateVariables: v.optional(v.record(v.string(), v.string())),
      occurrenceId: v.string(),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const initialized = await step.runAction(
      internal.scheduledJobs.workflow_actions.initializeScheduledExecution,
      { ...args, workflowId: String(step.workflowId) },
      { retry: true },
    );
    if (!initialized) return null;
    try {
      for (let stepIndex = 0; stepIndex < initialized.stepCount; stepIndex += 1) {
        await step.runAction(
          internal.scheduledJobs.workflow_actions.dispatchScheduledStep,
          {
            jobId: args.jobId,
            executionId: initialized.executionId,
            chatId: initialized.chatId,
            stepIndex,
          },
          { retry: true },
        );
        const result = await step.awaitEvent({
          name: scheduledStepEventName(stepIndex),
          validator: stepResultValidator,
        });
        if (result.status !== "completed") {
          await step.runAction(
            internal.scheduledJobs.workflow_actions.failScheduledExecution,
            {
              jobId: args.jobId,
              executionId: initialized.executionId,
              error: result.error ?? "Scheduled generation failed.",
            },
            { retry: true },
          );
          return null;
        }
      }

      await step.runAction(
        internal.scheduledJobs.workflow_actions.completeScheduledExecution,
        {
          jobId: args.jobId,
          executionId: initialized.executionId,
          chatId: initialized.chatId,
        },
        { retry: true },
      );
      return null;
    } catch (error) {
      await step.runAction(
        internal.scheduledJobs.workflow_actions.failScheduledExecution,
        {
          jobId: args.jobId,
          executionId: initialized.executionId,
          error: error instanceof Error ? error.message : String(error),
        },
        { retry: true },
      );
      throw error;
    }
  });
