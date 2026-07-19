import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { durableWorkflow } from "../execution/components";
import { startPresentationFanoutRef } from "./generation_fanout_refs";
import {
  completePresentationParentStepRef,
  failPresentationWorkflowStepRef,
  getPresentationWorkflowStateRef,
  runPresentationPlanStepRef,
  runPresentationSnapshotStepRef,
} from "./presentation_workflow_refs";
import { workflowArgsValidator } from "./presentation_workflow_validators";
import { PRESENTATION_RUN_TERMINAL_EVENT } from "./presentation_workflow_state";

export const runPresentationWorkflow = durableWorkflow
  .define({
    args: workflowArgsValidator,
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    let runId: Id<"presentationGenerationRuns"> | undefined;
    try {
      const planned = await step.runAction(
        runPresentationPlanStepRef,
        args,
        { retry: true, name: "presentation-plan" },
      );
      const started = await step.runMutation(startPresentationFanoutRef, {
        projectId: args.projectId,
        userId: args.userId,
        jobId: args.jobId,
        toolCallId: args.toolCallId,
        expectedRevision: planned.projectRevision,
        modelId: args.modelId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
        ...(args.requireZdrOverride !== undefined
          ? { requireZdrOverride: args.requireZdrOverride }
          : {}),
      }, { name: "presentation-studio-fanout" });
      runId = started.runId;

      await step.awaitEvent({ name: PRESENTATION_RUN_TERMINAL_EVENT });
      const state = await step.runQuery(getPresentationWorkflowStateRef, {
        projectId: args.projectId,
        userId: args.userId,
        jobId: args.jobId,
        runId,
      }, { name: "presentation-join" });
      if (!state.active) {
        await step.runAction(
          failPresentationWorkflowStepRef,
          {
            ...args,
            runId,
            cancelled: true,
            error: "Presentation generation was cancelled with its parent generation.",
          },
          { retry: false, name: "presentation-cancel" },
        );
        return null;
      }
      if (state.runStatus === "failed" || state.projectStatus === "failed") {
        throw new Error(state.error ?? "Presentation generation failed.");
      }
      if (
        state.runStatus !== "complete"
        || state.projectStatus !== "ready"
        || state.finalizedRevision === null
      ) throw new Error("Presentation terminal event did not contain a terminal state.");
      const result = await step.runAction(
        runPresentationSnapshotStepRef,
        { ...args, expectedRevision: state.finalizedRevision },
        { retry: true, name: "presentation-snapshot" },
      );
      await step.runAction(
        completePresentationParentStepRef,
        { ...args, result },
        { retry: true, name: "presentation-parent-resume" },
      );
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Presentation generation failed.";
      await step.runAction(
        failPresentationWorkflowStepRef,
        { ...args, error: message, ...(runId ? { runId } : {}) },
        { retry: true, name: "presentation-failure" },
      );
      return null;
    }
  });
