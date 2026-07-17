"use node";

import { internalAction } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import { completePlanningRef, getProjectInternalRef } from "./action_refs";
import { resolvePresentationAiAccess } from "./action_shared";
import { loadPresentationPromptAssets } from "./asset_inputs";
import { runDeferredPresentationGenerateRepairHandler } from "./deferred_generation_repair_handler";
import {
  schedulePhase,
  workflowIsActive,
} from "./deferred_workflow_actions";
import {
  presentationWorkflowArgs,
  runDeferredPresentationGenerateRef,
} from "./deferred_workflow_refs";
import {
  deferredPresentationRepairArgs,
  markPresentationFailedAndResume,
  presentationRepairDeps,
} from "./deferred_workflow_repair_shared";
import { PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS } from "./limits";
import { parsePresentationPlan } from "./model_parsing";
import { buildPlanningRepairMessages } from "./prompts";

export const runDeferredPresentationPlanRepair = internalAction({
  args: deferredPresentationRepairArgs,
  handler: async (ctx, args): Promise<void> => {
    try {
      if (!(await workflowIsActive(ctx, args.jobId))) return;
      const project = await ctx.runQuery(getProjectInternalRef, {
        projectId: args.projectId,
        userId: args.userId,
      });
      if (!project || project.status !== "planning") {
        throw new Error("Presentation planning repair is no longer current.");
      }
      const deps = presentationRepairDeps(args.userId);
      const ai = await resolvePresentationAiAccess(
        ctx,
        args.userId,
        args.modelId,
        args.requireZdrOverride,
        deps,
      );
      const assets = await loadPresentationPromptAssets(ctx, project);
      const response = await deps.callOpenRouterNonStreaming(
        ai.apiKey,
        ai.modelId,
        buildPlanningRepairMessages({
          prompt: project.prompt,
          direction: project.direction,
          imageMode: project.imageMode,
          invalidResponse: args.invalidResponse,
          validationError: args.validationError,
          assets,
        }),
        withZdrProvider(
          { temperature: 0.1, includeReasoning: false },
          ai.requireZdr,
        ),
        {
          fallbackModel: MODEL_IDS.appDefault,
          requestTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
          totalTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
        },
      );
      const parsed = parsePresentationPlan(response.content);
      await ctx.runMutation(completePlanningRef, {
        projectId: project._id,
        userId: args.userId,
        expectedRevision: project.revision,
        title: parsed.title,
        plan: parsed.slides,
        creativeDirection: parsed.creativeDirection,
        effectiveModelIds: [
          ...(args.priorEffectiveModelId ? [args.priorEffectiveModelId] : []),
          response.modelId ?? ai.modelId,
        ],
      });
      await schedulePhase(
        ctx,
        presentationWorkflowArgs(args),
        runDeferredPresentationGenerateRef,
      );
    } catch (error) {
      await markPresentationFailedAndResume(ctx, args, error);
    }
  },
});

export const runDeferredPresentationGenerateRepair = internalAction({
  args: deferredPresentationRepairArgs,
  handler: runDeferredPresentationGenerateRepairHandler,
});
