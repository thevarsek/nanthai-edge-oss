import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import { resolveComplexityPreset } from "./helpers";
import { researchPaperPipelineArgs } from "./workflow";
import { awaitResearchSearchBatch } from "./research_workflow_join";
import { runResearchRegenerationWorkflowHandler } from "./research_regeneration_workflow";
import { settleResearchFailureDisposition } from "./research_failure_settlement";
import { projectPipelineArgs } from "./workflow_shared";

export const runResearchPaperWorkflow = durableWorkflow
  .define({ args: researchPaperPipelineArgs, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    let executionAttemptId: typeof args.executionAttemptId;
    let executionFence: typeof args.executionFence;
    await step.runMutation(
      internal.search.execution_lifecycle.initializeResearchExecution,
      {
        sessionId: args.sessionId,
        jobId: args.jobId,
        workflowId: String(step.workflowId),
        parentExecutionRunId: args.parentExecutionRunId,
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
        ...projectPipelineArgs(args),
        executionAttemptId: session.executionAttemptId,
        executionFence: session.executionFence,
      };
      executionAttemptId = phaseArgs.executionAttemptId;
      executionFence = phaseArgs.executionFence;
      let phaseOrder = 0;
      await step.runMutation(
        internal.search.execution_lifecycle.heartbeatResearchExecution,
        {
          sessionId: args.sessionId,
          executionAttemptId: phaseArgs.executionAttemptId,
          executionFence: phaseArgs.executionFence,
        },
      );
      await step.runAction(
        internal.search.workflow_durable.runPlanningAction,
        {
          ...phaseArgs,
          phaseOrder: phaseOrder++,
          workflowManaged: true,
        },
        { retry: true },
      );
      const initialPhaseOrder = phaseOrder++;
      await step.runMutation(
        internal.search.execution_lifecycle.heartbeatResearchExecution,
        {
          sessionId: args.sessionId,
          executionAttemptId: phaseArgs.executionAttemptId,
          executionFence: phaseArgs.executionFence,
        },
      );
      const initialBatchId = await step.runAction(
        internal.search.research_fanout_prepare.prepareResearchSearchBatch,
        {
          sessionId: args.sessionId,
          userId: args.userId,
          complexity: args.complexity,
          phaseOrder: initialPhaseOrder,
          phaseType: "initial_search",
          executionAttemptId: phaseArgs.executionAttemptId,
          executionFence: phaseArgs.executionFence,
        },
        { retry: true },
      );
      await awaitResearchSearchBatch(step, initialBatchId);
      await step.runMutation(
        internal.search.execution_lifecycle.heartbeatResearchExecution,
        {
          sessionId: args.sessionId,
          executionAttemptId: phaseArgs.executionAttemptId,
          executionFence: phaseArgs.executionFence,
        },
      );
      await step.runAction(
        internal.search.workflow_durable.runInitialSearchAction,
        {
          ...phaseArgs,
          phaseOrder: initialPhaseOrder,
          workflowManaged: true,
          searchBatchId: initialBatchId,
        },
        { retry: true },
      );

      const depthIterations = Math.max(
        0,
        resolveComplexityPreset("paper", args.complexity).depth - 1,
      );
      for (
        let depthIteration = 0;
        depthIteration < depthIterations;
        depthIteration += 1
      ) {
        await step.runMutation(
          internal.search.execution_lifecycle.heartbeatResearchExecution,
          {
            sessionId: args.sessionId,
            executionAttemptId: phaseArgs.executionAttemptId,
            executionFence: phaseArgs.executionFence,
          },
        );
        await step.runAction(
          internal.search.workflow_durable.runAnalysisAction,
          {
            ...phaseArgs,
            phaseOrder: phaseOrder++,
            depthIteration,
            workflowManaged: true,
          },
          { retry: true },
        );
        const depthPhaseOrder = phaseOrder++;
        const depthBatchId = await step.runAction(
          internal.search.research_fanout_prepare.prepareResearchSearchBatch,
          {
            sessionId: args.sessionId,
            userId: args.userId,
            complexity: args.complexity,
            phaseOrder: depthPhaseOrder,
            phaseType: "depth_iteration",
            iteration: depthIteration,
            executionAttemptId: phaseArgs.executionAttemptId,
            executionFence: phaseArgs.executionFence,
          },
          { retry: true },
        );
        await awaitResearchSearchBatch(step, depthBatchId);
        await step.runMutation(
          internal.search.execution_lifecycle.heartbeatResearchExecution,
          {
            sessionId: args.sessionId,
            executionAttemptId: phaseArgs.executionAttemptId,
            executionFence: phaseArgs.executionFence,
          },
        );
        await step.runAction(
          internal.search.workflow_durable.runDepthSearchAction,
          {
            ...phaseArgs,
            phaseOrder: depthPhaseOrder,
            depthIteration,
            workflowManaged: true,
            searchBatchId: depthBatchId,
          },
          { retry: true },
        );
      }
      await step.runMutation(
        internal.search.execution_lifecycle.heartbeatResearchExecution,
        {
          sessionId: args.sessionId,
          executionAttemptId: phaseArgs.executionAttemptId,
          executionFence: phaseArgs.executionFence,
        },
      );
      await step.runAction(
        internal.search.workflow_durable.runSynthesisAction,
        {
          ...phaseArgs,
          phaseOrder: phaseOrder++,
          workflowManaged: true,
        },
        { retry: true },
      );
      await step.runMutation(
        internal.search.execution_lifecycle.heartbeatResearchExecution,
        {
          sessionId: args.sessionId,
          executionAttemptId: phaseArgs.executionAttemptId,
          executionFence: phaseArgs.executionFence,
        },
      );
      await step.runAction(
        internal.search.workflow_durable.runPaperArchitectureAction,
        {
          ...phaseArgs,
          phaseOrder: phaseOrder++,
          workflowManaged: true,
        },
        { retry: true },
      );
      await step.runAction(
        internal.search.workflow_durable.runPaperHandoffAction,
        {
          ...phaseArgs,
          phaseOrder,
          workflowManaged: true,
        },
        { retry: true },
      );
      await step.runMutation(
        internal.search.execution_lifecycle.terminalizeResearchExecution,
        {
          sessionId: args.sessionId,
          outcome: "completed",
          summary: "Research paper workflow completed",
          executionAttemptId: phaseArgs.executionAttemptId,
          executionFence: phaseArgs.executionFence,
        },
      );
      return null;
    } catch (error) {
      const summary = error instanceof Error ? error.message : String(error);
      const disposition = await step.runAction(
        internal.search.workflow_durable.finalizeResearchWorkflowFailure,
        {
          ...projectPipelineArgs(args),
          phaseOrder: -1,
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
          handedOff: "Research generation handoff committed",
          alreadyCompleted: "Research session already completed",
          cancelled: "Research session cancelled",
        },
      );
      if (settled) return null;
      throw error;
    }
  });

export const runResearchRegenerationWorkflow = durableWorkflow
  .define({
    args: { ...researchPaperPipelineArgs, phaseOrder: v.number() },
    returns: v.null(),
  })
  .handler(runResearchRegenerationWorkflowHandler);
