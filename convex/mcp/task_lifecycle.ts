import type { EventId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { terminalizeExecution } from "../execution/control_plane";
import { isSettledWorkflowSignalError } from "../execution/workflow_signal_errors";
import { completeDeferredToolHandler } from "../chat/workflow_resume_handlers";
import { remoteTaskExecution, remoteTaskResumeValue } from "./task_contract";
import { mcpJsonFromStorage } from "./json_codec";
import { resumeMcpExecutionForInvocation } from "./execution_waiting";

function terminalOutcome(state: string): "completed" | "failed" | "cancelled" {
  if (state === "completed") return "completed";
  if (state === "cancelled") return "cancelled";
  return "failed";
}

type SignalTaskInputArgs = {
  invocationId: Id<"mcpInvocations">;
  userId: string;
  action: "continue" | "cancel" | "terminal";
};

type SendTaskInputEvent = (
  ctx: MutationCtx,
  eventId: string,
  action: "continue" | "cancel",
) => Promise<void>;

const sendTaskInputEvent: SendTaskInputEvent = async (ctx, eventId, action) => {
  await durableWorkflow.sendEvent(ctx, {
    id: eventId as EventId<string>,
    validator: remoteTaskResumeValue,
    value: { action },
  });
};

type SettleDeferredInvocationArgs = {
  invocationId: Id<"mcpInvocations">;
  execution: {
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId: string;
  };
};

export async function settleDeferredInvocationHandler(
  ctx: MutationCtx,
  args: SettleDeferredInvocationArgs,
  sendEvent: SendTaskInputEvent = sendTaskInputEvent,
): Promise<null> {
  const invocation = await ctx.db.get(args.invocationId);
  if (!invocation || invocation.durableRunId !== args.execution.runId) return null;
  const terminal = ["completed", "failed", "cancelled", "outcome_unknown"].includes(
    invocation.state,
  );
  if (!terminal) return null;
  if (invocation.taskResumeEventId) {
    await signalTaskInputHandler(ctx, {
      invocationId: invocation._id,
      userId: invocation.userId,
      action: "terminal",
    }, sendEvent);
  }
  if (
    invocation.parentResumeEventId
    && invocation.generationJobId
    && invocation.toolCallId
  ) {
    const result = invocation.state === "completed"
      ? JSON.stringify(mcpJsonFromStorage(invocation.result) ?? { state: "completed" }).slice(0, 50_000)
      : JSON.stringify({
          error: invocation.errorCode ?? "Remote MCP request did not complete.",
          state: invocation.state,
        });
    await completeDeferredToolHandler(ctx, {
      jobId: invocation.generationJobId,
      userId: invocation.userId,
      toolCallId: invocation.toolCallId,
      toolName: invocation.method === "tools/call"
        ? invocation.toolAlias ?? "remote_mcp"
        : "remote_mcp",
      result,
      isError: invocation.state === "completed" ? undefined : true,
      eventId: invocation.parentResumeEventId,
    });
  }
  await terminalizeExecution(ctx, {
    attemptId: args.execution.attemptId,
    fence: args.execution.fence,
    claimantId: args.execution.claimantId,
    outcome: terminalOutcome(invocation.state),
    summary: invocation.state === "completed"
      ? "Remote MCP request completed"
      : invocation.errorCode ?? `Remote MCP request ${invocation.state}`,
    allowExpiredLease: true,
    allowWaiting: true,
  });
  return null;
}

export const settleDeferredInvocation = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    execution: remoteTaskExecution,
  },
  returns: v.null(),
  handler: settleDeferredInvocationHandler,
});

export const scheduleDeferredInvocationSettlement = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    execution: remoteTaskExecution,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      1_000,
      internal.mcp.task_lifecycle.settleDeferredInvocation,
      args,
    );
    return null;
  },
});

export async function signalTaskInputHandler(
  ctx: MutationCtx,
  args: SignalTaskInputArgs,
  sendEvent: SendTaskInputEvent = sendTaskInputEvent,
): Promise<boolean> {
  const invocation = await ctx.db.get(args.invocationId);
  if (!invocation || invocation.userId !== args.userId || !invocation.taskResumeEventId) {
    return false;
  }
  const terminal = ["completed", "failed", "cancelled", "outcome_unknown"].includes(
    invocation.state,
  );
  const pending = invocation.state === "awaiting_input" || invocation.state === "task_pending";
  if ((args.action === "terminal" && !terminal) || (args.action !== "terminal" && !pending)) {
    return false;
  }
  if (!await resumeMcpExecutionForInvocation(ctx, invocation)) return false;

  const now = Date.now();
  const eventId = invocation.taskResumeEventId;
  await ctx.db.patch(invocation._id, {
    taskResumeEventId: undefined,
    ...(args.action === "terminal" ? {} : {
      state: args.action === "cancel" ? "cancelled" as const : "task_pending" as const,
      completedAt: args.action === "cancel" ? now : undefined,
    }),
    updatedAt: now,
  });
  try {
    await sendEvent(ctx, eventId, args.action === "continue" ? "continue" : "cancel");
  } catch (error) {
    if (!isSettledWorkflowSignalError(error)) throw error;
  }
  return true;
}

export const signalTaskInput = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    userId: v.string(),
    action: v.union(v.literal("continue"), v.literal("cancel"), v.literal("terminal")),
  },
  returns: v.boolean(),
  handler: signalTaskInputHandler,
});
