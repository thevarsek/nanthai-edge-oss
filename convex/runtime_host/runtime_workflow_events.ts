import type { EventId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { isIgnorableResumeSignalError } from "../chat/workflow_resume_handlers";

export const runtimeCompletionEventValue = v.object({
  status: v.union(
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  commandId: v.string(),
});

export type RuntimeCompletionEventValue = {
  status: "completed" | "failed" | "cancelled";
  commandId: string;
};

export async function signalRuntimeCompletionHandler(ctx: MutationCtx, args: {
  eventId: string;
  value: RuntimeCompletionEventValue;
}): Promise<boolean> {
  try {
    await durableWorkflow.sendEvent(ctx, {
      id: args.eventId as EventId<string>,
      validator: runtimeCompletionEventValue,
      value: args.value,
    });
    return true;
  } catch (error) {
    if (isIgnorableResumeSignalError(error)) return false;
    throw error;
  }
}

export const signalRuntimeCompletion = internalMutation({
  args: {
    eventId: v.string(),
    value: runtimeCompletionEventValue,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await signalRuntimeCompletionHandler(ctx, args),
});
