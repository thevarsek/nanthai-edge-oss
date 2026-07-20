import { v } from "convex/values";
import { internal } from "../_generated/api";
import { durableWorkflow } from "../execution/components";
import { failClosedProviderActionOptions } from
  "../execution/workflow_retry_policy";

export const runAnalyticsWorkflow = durableWorkflow
  .define({
    args: {
      analyticsRunId: v.id("analyticsWorkflowRuns"),
      claimantId: v.string(),
    },
    returns: v.null(),
  })
  .handler(async (step, args): Promise<null> => {
    const mark = async (phase: string) => await step.runMutation(
      internal.analytics_workflows.mutations.setPhase,
      { analyticsRunId: args.analyticsRunId, phase, claimantId: args.claimantId },
    );
    try {
      await mark("prepare");
      await step.runAction(
        internal.analytics_workflows.hydrate_action.hydrate,
        { analyticsRunId: args.analyticsRunId, claimantId: args.claimantId },
        { retry: true },
      );
      await mark("execute");
      await step.runAction(
        internal.analytics_workflows.actions.execute,
        { analyticsRunId: args.analyticsRunId, claimantId: args.claimantId },
        failClosedProviderActionOptions,
      );
      let state = await step.runQuery(internal.analytics_workflows.queries.getStatus, {
        analyticsRunId: args.analyticsRunId,
      });
      if (!state) throw new Error("ANALYTICS_RUN_NOT_FOUND");
      if (state.status !== "failed" && state.status !== "cancelled") {
        await mark("collect");
        await step.runAction(
          internal.analytics_workflows.actions.collect,
          { analyticsRunId: args.analyticsRunId, claimantId: args.claimantId },
          { retry: true },
        );
        state = await step.runQuery(internal.analytics_workflows.queries.getStatus, {
          analyticsRunId: args.analyticsRunId,
        });
        if (!state) throw new Error("ANALYTICS_RUN_NOT_FOUND");
      }
      if (state.status !== "failed" && state.status !== "cancelled") {
        await step.runAction(
          internal.analytics_workflows.normalize_action.normalize,
          { analyticsRunId: args.analyticsRunId, claimantId: args.claimantId },
          { retry: true },
        );
        await step.runMutation(internal.analytics_workflows.result_mutations.persistNormalized, {
          analyticsRunId: args.analyticsRunId,
          claimantId: args.claimantId,
        });
        await step.runMutation(internal.analytics_workflows.result_mutations.attach, {
          analyticsRunId: args.analyticsRunId,
          claimantId: args.claimantId,
        });
        await mark("cleanup");
      }
      await step.runAction(
        internal.analytics_workflows.actions.resumeParent,
        { analyticsRunId: args.analyticsRunId, claimantId: args.claimantId },
        { retry: true },
      );
      const outcome = state.status === "cancelled" ? "cancelled" : state.status === "failed"
        ? "failed"
        : "completed";
      await step.runMutation(internal.analytics_workflows.mutations.finishExecution, {
        analyticsRunId: args.analyticsRunId,
        claimantId: args.claimantId,
        outcome,
      });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await step.runMutation(internal.analytics_workflows.mutations.storeResult, {
        analyticsRunId: args.analyticsRunId,
        claimantId: args.claimantId,
        resultBytes: new TextEncoder().encode(message).byteLength,
        error: message,
      }).catch(() => undefined);
      await step.runAction(
        internal.analytics_workflows.actions.resumeParent,
        { analyticsRunId: args.analyticsRunId, claimantId: args.claimantId },
        { retry: true },
      );
      await step.runMutation(internal.analytics_workflows.mutations.finishExecution, {
        analyticsRunId: args.analyticsRunId,
        claimantId: args.claimantId,
        outcome: "failed",
      }).catch(() => undefined);
      throw error;
    }
  });
