import type { ActionCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import {
  type PresentationActionDeps,
  createPresentationActionDepsForTest,
  requireProjectForAction,
  resolvePresentationAiAccess,
} from "./action_shared";
import { beginPlanningRef, completePlanningRef, markFailedRef } from "./action_refs";
import {
  MAX_PROMPT_CHARS,
  PRESENTATION_MODEL_TIMEOUT_MS,
  assertProjectCanBeEdited,
  requireBoundedText,
  safePresentationErrorMessage,
} from "./limits";
import {
  parsePresentationPlan,
  parseRepairedPresentationPlan,
} from "./model_parsing";
import { buildPlanningMessages, buildPlanningRepairMessages } from "./prompts";
import { loadPresentationPromptAssets } from "./asset_inputs";
import { DeferredPresentationRepair } from "./deferred_repair";
import type {
  PlanProjectActionResult,
  ParsedPresentationPlan,
  PresentationDirection,
  PresentationImageMode,
  PresentationProjectId,
  ProjectRevisionResult,
} from "./types";

export async function planProjectHandler(
  ctx: ActionCtx,
  args: {
    projectId: PresentationProjectId;
    prompt: string;
    direction: PresentationDirection;
    imageMode: PresentationImageMode;
    modelId?: string;
    requireZdrOverride?: boolean;
  },
  deps: PresentationActionDeps = createPresentationActionDepsForTest(),
  options: {
    deferRepair?: boolean;
    modelTimeoutMs?: number;
    workflowManaged?: boolean;
  } = {},
): Promise<PlanProjectActionResult> {
  const { userId } = await deps.requireAuth(ctx);
  const prompt = requireBoundedText(args.prompt, "Presentation brief", MAX_PROMPT_CHARS);
  const project = await requireProjectForAction(ctx, args.projectId, userId);
  const resumeWorkflowPlanning = options.workflowManaged && project.status === "planning";
  if (!resumeWorkflowPlanning) assertProjectCanBeEdited(project.status);
  const ai = await resolvePresentationAiAccess(
    ctx,
    userId,
    args.modelId,
    args.requireZdrOverride,
    deps,
  );
  const started: ProjectRevisionResult = resumeWorkflowPlanning
    ? { projectId: project._id, projectRevision: project.revision }
    : await ctx.runMutation(
      beginPlanningRef,
      {
        projectId: project._id,
        userId,
        expectedRevision: project.revision,
        prompt,
        direction: args.direction,
        imageMode: args.imageMode,
        modelId: ai.modelId,
        ...(options.workflowManaged ? { workflowManaged: true } : {}),
      },
    );
  const modelTimeoutMs = options.modelTimeoutMs ?? PRESENTATION_MODEL_TIMEOUT_MS;

  try {
    const assets = await loadPresentationPromptAssets(ctx, project);
    const response = await deps.callOpenRouterNonStreaming(
      ai.apiKey,
      ai.modelId,
      buildPlanningMessages({
        prompt,
        direction: args.direction,
        imageMode: args.imageMode,
        assets,
      }),
      withZdrProvider({ temperature: 0.35, includeReasoning: false }, ai.requireZdr),
      {
        fallbackModel: MODEL_IDS.appDefault,
        requestTimeoutMs: modelTimeoutMs,
        totalTimeoutMs: modelTimeoutMs,
      },
    );
    let parsed: ParsedPresentationPlan;
    const effectiveModelIds = [response.modelId ?? ai.modelId];
    try {
      parsed = parsePresentationPlan(response.content);
    } catch (parseError) {
      const validationError = safePresentationErrorMessage(parseError);
      if (options.deferRepair) {
        throw new DeferredPresentationRepair(
          response.content,
          validationError,
          undefined,
          response.modelId ?? ai.modelId,
        );
      }
      const repaired = await deps.callOpenRouterNonStreaming(
        ai.apiKey,
        ai.modelId,
        buildPlanningRepairMessages({
          prompt,
          direction: args.direction,
          imageMode: args.imageMode,
          invalidResponse: response.content,
          validationError,
          assets,
        }),
        withZdrProvider(
          { temperature: 0.1, includeReasoning: false },
          ai.requireZdr,
        ),
        {
          fallbackModel: MODEL_IDS.appDefault,
          requestTimeoutMs: modelTimeoutMs,
          totalTimeoutMs: modelTimeoutMs,
        },
      );
      effectiveModelIds.push(repaired.modelId ?? ai.modelId);
      parsed = parseRepairedPresentationPlan(repaired.content);
    }
    const completed: ProjectRevisionResult = await ctx.runMutation(
      completePlanningRef,
      {
        projectId: project._id,
        userId,
        expectedRevision: started.projectRevision,
        title: parsed.title,
        plan: parsed.slides,
        creativeDirection: parsed.creativeDirection,
        effectiveModelIds,
        ...(options.workflowManaged ? { workflowManaged: true } : {}),
      },
    );
    return {
      projectId: project._id,
      status: "planned" as const,
      projectRevision: completed.projectRevision,
      plan: parsed.slides,
    };
  } catch (error) {
    if (!(error instanceof DeferredPresentationRepair) && !options.workflowManaged) {
      await ctx.runMutation(markFailedRef, {
        projectId: project._id,
        userId,
        expectedRevision: started.projectRevision,
        error: safePresentationErrorMessage(error),
      });
    }
    throw error;
  }
}
