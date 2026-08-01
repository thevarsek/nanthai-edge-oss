import type { EventId, WorkflowCtx, WorkflowId } from "@convex-dev/workflow";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { durableWorkflow } from "../execution/components";
import { remoteTaskExecution, remoteTaskResumeValue } from "./task_contract";
import type { RemoteTaskPollState } from "./task_worker_action";

const MAX_POLLS = 240;
const POLL_INTERVAL_MS = 15_000;

export async function runRemoteTaskWorkflowHandler(
  step: WorkflowCtx,
  args: {
    invocationId: Id<"mcpInvocations">;
    execution: {
      runId: Id<"executionRuns">;
      attemptId: Id<"executionAttempts">;
      fence: number;
      claimantId: string;
    };
  },
): Promise<null> {
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    if (poll > 0) await step.sleep(POLL_INTERVAL_MS);
    await step.runMutation(internal.execution.mutations.heartbeat, {
      attemptId: args.execution.attemptId,
      fence: args.execution.fence,
      claimantId: args.execution.claimantId,
      leaseMs: 60 * 60 * 1_000,
    });
    const operationKey = `remote-mcp-task-poll:${String(args.invocationId)}:${poll}`;
    const decision = await step.runMutation(internal.execution.operations.prepare, {
      attemptId: args.execution.attemptId,
      fence: args.execution.fence,
      operationKey,
      toolName: "remote_mcp_tasks_get",
      toolCallId: operationKey,
      effect: "read",
      retry: "safe",
      authorizationSource: "runtime_policy",
      inputHash: String(args.invocationId),
    });
    let outcome: { state: RemoteTaskPollState };
    if (decision.decision === "replay") {
      outcome = JSON.parse(decision.resultJson) as { state: RemoteTaskPollState };
    } else if (decision.decision === "refuse") {
      outcome = { state: "outcome_unknown" };
    } else {
      await step.runMutation(internal.execution.operations.markDispatched, {
        attemptId: args.execution.attemptId,
        fence: args.execution.fence,
        operationKey,
      });
      outcome = await step.runAction(
        internal.mcp.task_worker_action.pollRemoteTask,
        { ...args, operationKey },
        { retry: false },
      );
      if (outcome.state === "retry") {
        await step.runMutation(internal.execution.operations.resetSafeFailure, {
          attemptId: args.execution.attemptId,
          fence: args.execution.fence,
          operationKey,
          errorSummary: "Remote MCP task poll failed safely.",
        });
      } else {
        await step.runMutation(internal.execution.operations.complete, {
          attemptId: args.execution.attemptId,
          fence: args.execution.fence,
          operationKey,
          externalId: String(args.invocationId),
          resultJson: JSON.stringify(outcome),
        });
      }
    }
    if (outcome.state === "awaiting_input") {
      const eventId = await step.runMutation(
        internal.mcp.task_workflow.createRemoteTaskResume,
        { workflowId: String(step.workflowId), name: `input:${poll}` },
      ) as EventId<string>;
      const waiting = await step.runMutation(internal.mcp.lifecycle_mutations.markTaskWaitingForInput, {
        invocationId: args.invocationId,
        execution: args.execution,
        eventId: String(eventId),
      });
      if (!waiting) continue;
      const resume = await step.awaitEvent({ id: eventId, validator: remoteTaskResumeValue });
      if (resume.action === "cancel") break;
      if (poll === MAX_POLLS - 1) {
        await step.runMutation(internal.mcp.invocation_mutations.failPendingInvocation, {
          invocationId: args.invocationId,
          errorCode: "MCP_TASK_POLL_LIMIT_REACHED",
        });
        break;
      }
      continue;
    }
    if (["missing", "disabled"].includes(outcome.state)) {
      await step.runMutation(internal.mcp.invocation_mutations.failPendingInvocation, {
        invocationId: args.invocationId,
        errorCode: outcome.state === "missing"
          ? "MCP_INVOCATION_MISSING"
          : "MCP_CONNECTION_DISABLED",
      });
      break;
    }
    if (["completed", "failed", "cancelled", "outcome_unknown"].includes(outcome.state)) break;
    if (poll === MAX_POLLS - 1) {
      await step.runMutation(internal.mcp.invocation_mutations.failPendingInvocation, {
        invocationId: args.invocationId,
        errorCode: "MCP_TASK_POLL_LIMIT_REACHED",
      });
    }
  }
  await step.runMutation(internal.mcp.task_lifecycle.settleDeferredInvocation, args);
  return null;
}

export const runRemoteTaskWorkflow = durableWorkflow
  .define({
    args: {
      invocationId: v.id("mcpInvocations"),
      execution: remoteTaskExecution,
    },
    returns: v.null(),
  })
  .handler(runRemoteTaskWorkflowHandler);

export const createRemoteTaskResume = internalMutation({
  args: { workflowId: v.string(), name: v.string() },
  handler: async (ctx, args) => await durableWorkflow.createEvent(ctx, {
    workflowId: args.workflowId as WorkflowId,
    name: args.name,
  }),
});
