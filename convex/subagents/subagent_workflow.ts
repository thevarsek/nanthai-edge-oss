import { v } from "convex/values";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import {
  subagentWorkflowArgs,
  type SubagentWorkflowArgs,
} from "./subagent_workflow_handoff";

/** A journal-size boundary, not a child-agent tool-round limit. */
export const SUBAGENT_WORKFLOW_ROUNDS_PER_CHUNK = 24;

export function nextSubagentInvocationOffset(offset: string): string {
  if (!/^(0|[1-9][0-9]*)$/.test(offset)) {
    throw new Error("SUBAGENT_WORKFLOW_INVOCATION_OFFSET_INVALID");
  }
  const digits = [...offset];
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry === 1; index -= 1) {
    const digit = Number(digits[index]) + carry;
    digits[index] = String(digit % 10);
    carry = digit >= 10 ? 1 : 0;
  }
  if (carry === 1) digits.unshift("1");
  return digits.join("");
}

export async function runSubagentWorkflowHandler(
  step: WorkflowCtx,
  args: SubagentWorkflowArgs,
): Promise<null> {
  const claimantId = `subagent-workflow:${String(args.runId)}`;
  const execution = await step.runMutation(internal.execution.mutations.claimRun, {
    runId: args.executionRunId,
    claimantId,
  });
  if (!execution) return null;
  const rebound = await step.runMutation(
    internal.execution.component_refs.rebindWorkflowAttempt,
    {
      workflowId: String(step.workflowId),
      runId: args.executionRunId,
      attemptId: execution.attemptId,
      fence: execution.fence,
    },
  );
  if (!rebound) throw new Error("SUBAGENT_WORKFLOW_COMPONENT_REBIND_FAILED");
  let nextInvocationOffset = args.nextInvocationOffset ?? "0";
  for (
    let invocation = 0;
    invocation < SUBAGENT_WORKFLOW_ROUNDS_PER_CHUNK;
    invocation += 1
  ) {
    nextInvocationOffset = nextSubagentInvocationOffset(nextInvocationOffset);
    await step.runMutation(internal.execution.mutations.heartbeat, {
      attemptId: execution.attemptId,
      fence: execution.fence,
      claimantId,
    });
    await step.runAction(
      internal.subagents.actions.runSubagentRun,
      {
        runId: args.runId,
        workflowManaged: true,
        executionAttemptId: execution.attemptId,
        executionFence: execution.fence,
      },
      { retry: true },
    );
    const run = await step.runQuery(internal.subagents.queries.getRunInternal, {
      runId: args.runId,
    });
    if (!run) {
      await step.runMutation(internal.execution.mutations.terminalize, {
        attemptId: execution.attemptId,
        fence: execution.fence,
        claimantId,
        outcome: "interrupted",
        summary: "Subagent run was removed",
      });
      return null;
    }
    if (run.status === "waiting_continuation") continue;
    if (["completed", "failed", "cancelled", "timedOut"].includes(run.status)) {
      const outcome = run.status === "completed"
        ? "completed" as const
        : run.status === "cancelled"
          ? "cancelled" as const
          : "failed" as const;
      await step.runMutation(internal.execution.mutations.terminalize, {
        attemptId: execution.attemptId,
        fence: execution.fence,
        claimantId,
        outcome,
        summary: `Subagent ${run.status}`,
      });
      await step.runAction(
        internal.subagents.actions.continueParentAfterSubagents,
        { batchId: run.batchId },
        { retry: true },
      );
      return null;
    }
    await step.runMutation(internal.execution.mutations.terminalize, {
      attemptId: execution.attemptId,
      fence: execution.fence,
      claimantId,
      outcome: "failed",
      summary: `Invalid subagent state: ${run.status}`,
    });
    throw new Error(`SUBAGENT_WORKFLOW_INVALID_STATE:${run.status}`);
  }

  await step.runMutation(internal.subagents.subagent_workflow_handoff.startSubagentSuccessor, {
    ...args,
    predecessorWorkflowId: String(step.workflowId),
    nextInvocationOffset,
    attemptId: execution.attemptId,
    fence: execution.fence,
  });
  return null;
}

export const runSubagentWorkflow = durableWorkflow
  .define({
    args: subagentWorkflowArgs,
    returns: v.null(),
  })
  .handler(runSubagentWorkflowHandler);
