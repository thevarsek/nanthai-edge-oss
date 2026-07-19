import type { WorkflowCtx } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import type { PipelineArgs } from "./workflow_shared";
import { settleResearchFailureDisposition } from "./research_failure_settlement";

export interface ResearchRegenerationWorkflowArgs extends PipelineArgs {
  phaseOrder: number;
}

export async function runResearchRegenerationWorkflowHandler(
  step: WorkflowCtx,
  args: ResearchRegenerationWorkflowArgs,
): Promise<null> {
  let executionAttemptId = args.executionAttemptId;
  let executionFence = args.executionFence;
  await step.runMutation(
    internal.search.execution_lifecycle.initializeResearchExecution,
    {
      sessionId: args.sessionId,
      jobId: args.jobId,
      workflowId: String(step.workflowId),
    },
  );
  try {
    const session = await step.runQuery(
      internal.search.queries.getSearchSession,
      { sessionId: args.sessionId },
    );
    if (!session?.executionAttemptId || session.executionFence === undefined) {
      throw new Error("RESEARCH_EXECUTION_FENCE_MISSING");
    }
    const phaseArgs = {
      ...args,
      executionAttemptId: session.executionAttemptId,
      executionFence: session.executionFence,
    };
    executionAttemptId = phaseArgs.executionAttemptId;
    executionFence = phaseArgs.executionFence;
    let phaseOrder = args.phaseOrder;
    await step.runMutation(
      internal.search.execution_lifecycle.heartbeatResearchExecution,
      {
        sessionId: args.sessionId,
        executionAttemptId,
        executionFence,
      },
    );
    await step.runAction(
      internal.search.workflow_durable.runSynthesisAction,
      { ...phaseArgs, phaseOrder: phaseOrder++, workflowManaged: true },
      { retry: true },
    );
    await step.runMutation(
      internal.search.execution_lifecycle.heartbeatResearchExecution,
      { sessionId: args.sessionId, executionAttemptId, executionFence },
    );
    await step.runAction(
      internal.search.workflow_durable.runPaperArchitectureAction,
      { ...phaseArgs, phaseOrder: phaseOrder++, workflowManaged: true },
      { retry: true },
    );
    await step.runAction(
      internal.search.workflow_durable.runPaperHandoffAction,
      { ...phaseArgs, phaseOrder, workflowManaged: true },
      { retry: true },
    );
    await step.runMutation(
      internal.search.execution_lifecycle.terminalizeResearchExecution,
      {
        sessionId: args.sessionId,
        outcome: "completed",
        summary: "Research paper regeneration completed",
        executionAttemptId,
        executionFence,
      },
    );
    return null;
  } catch (error) {
    const summary = error instanceof Error ? error.message : String(error);
    const disposition = await step.runAction(
      internal.search.workflow_durable.finalizeResearchWorkflowFailure,
      {
        ...args,
        executionAttemptId,
        executionFence,
        workflowManaged: true,
        error: summary,
      },
      { retry: true },
    );
    const settled = await settleResearchFailureDisposition(
      step,
      {
        sessionId: args.sessionId,
        executionAttemptId,
        executionFence,
      },
      disposition,
      summary,
      {
        handedOff: "Research regeneration handoff committed",
        alreadyCompleted: "Research regeneration session already completed",
        cancelled: "Research regeneration session cancelled",
      },
    );
    if (settled) return null;
    throw error;
  }
}
