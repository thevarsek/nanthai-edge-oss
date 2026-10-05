import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import { runtimeCompletionEventValue, type RuntimeCompletionEventValue } from "./runtime_workflow_events";
import type { Id } from "../_generated/dataModel";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { EventId } from "@convex-dev/workflow";

export async function runHelperWorkflowHandler(step: WorkflowCtx, { taskId }: { taskId: Id<"runtimeHelperTasks"> }): Promise<null> {
    let failed = true;
    try {
      const eventId = await step.runMutation(internal.chat.workflow_events.createGenerationResume, {
        workflowId: step.workflowId, name: `helper:${String(taskId)}`,
      }) as EventId<string>;
      await step.runMutation(internal.runtime_host.helper_tasks.setEvent, { taskId, eventId });
      await step.runAction(internal.runtime_host.helper_dispatch.dispatch, { taskId }, { retry: false });
      const result = await step.awaitEvent<RuntimeCompletionEventValue>({ id: eventId, validator: runtimeCompletionEventValue });
      if (result.status === "completed") {
        await step.runAction(internal.runtime_host.helper_dispatch.consume, { taskId }, { retry: false });
        failed = false;
      }
    } finally {
      await step.runMutation(internal.runtime_host.helper_tasks.finish, { taskId, failed });
    }
    return null;
}

export const run = durableWorkflow.define({
  args: { taskId: v.id("runtimeHelperTasks") },
  returns: v.null(),
  handler: runHelperWorkflowHandler,
});
