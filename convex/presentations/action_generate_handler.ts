import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import {
  type PresentationActionDeps,
  createPresentationActionDepsForTest,
  requireProjectForAction,
  resolvePresentationAiAccess,
} from "./action_shared";
import { beginGenerationRef, completeGenerationRef, markFailedRef } from "./action_refs";
import {
  PRESENTATION_MODEL_TIMEOUT_MS,
  safePresentationErrorMessage,
} from "./limits";
import {
  PresentationDeckSlideLayoutError,
  parsePresentationDeck,
} from "./model_parsing";
import {
  buildGenerationLayoutRepairMessages,
  buildGenerationMessages,
  buildGenerationRepairMessages,
} from "./prompts";
import { loadPresentationPromptAssets } from "./asset_inputs";
import { DeferredPresentationRepair } from "./deferred_repair";
import {
  applyPresentationLayoutRepair,
  presentationSlideRepairTarget,
} from "./generation_layout_repair";
import type {
  GenerateProjectActionResult,
  PresentationProjectId,
  ProjectRevisionResult,
} from "./types";

export async function generateProjectHandler(
  ctx: ActionCtx,
  args: {
    projectId: PresentationProjectId;
    modelId?: string;
    requireZdrOverride?: boolean;
  },
  deps: PresentationActionDeps = createPresentationActionDepsForTest(),
  options: {
    deferRepair?: boolean;
    modelTimeoutMs?: number;
  } = {},
): Promise<GenerateProjectActionResult> {
  const { userId } = await deps.requireAuth(ctx);
  const project = await requireProjectForAction(ctx, args.projectId, userId);
  if (project.status !== "planned" || !project.plan?.length) {
    throw new ConvexError({
      code: "INVALID_STATE",
      message: "Plan this presentation before generating slides.",
    });
  }
  const ai = await resolvePresentationAiAccess(
    ctx,
    userId,
    args.modelId,
    args.requireZdrOverride,
    deps,
  );
  const started: ProjectRevisionResult = await ctx.runMutation(
    beginGenerationRef,
    {
      projectId: project._id,
      userId,
      expectedRevision: project.revision,
      modelId: ai.modelId,
    },
  );
  const modelTimeoutMs = options.modelTimeoutMs ?? PRESENTATION_MODEL_TIMEOUT_MS;

  try {
    const assets = await loadPresentationPromptAssets(ctx, project);
    const promptArgs = {
      title: project.title,
      prompt: project.prompt,
      direction: project.direction,
      imageMode: project.imageMode,
      plan: project.plan,
      creativeDirection: project.creativeDirection,
      assets,
    };
    const response = await deps.callOpenRouterNonStreaming(
      ai.apiKey,
      ai.modelId,
      buildGenerationMessages(promptArgs),
      withZdrProvider({
        temperature: 0.65,
        includeReasoning: false,
      }, ai.requireZdr),
      {
        fallbackModel: MODEL_IDS.appDefault,
        requestTimeoutMs: modelTimeoutMs,
        totalTimeoutMs: modelTimeoutMs,
      },
    );
    let parsed;
    try {
      parsed = parsePresentationDeck(
        response.content,
        project.plan,
        project.imageMode,
        (project.assetStorageIds ?? []).map(String),
      );
    } catch (parseError) {
      const validationError = safePresentationErrorMessage(parseError);
      if (options.deferRepair) {
        throw new DeferredPresentationRepair(
          response.content,
          validationError,
          parseError instanceof PresentationDeckSlideLayoutError
            ? parseError.slideId
            : undefined,
          response.modelId ?? ai.modelId,
        );
      }
      const layoutSlideId = parseError instanceof PresentationDeckSlideLayoutError
        ? parseError.slideId
        : undefined;
      const layoutPlanSlide = layoutSlideId
        ? project.plan.find((slide) => slide.id === layoutSlideId)
        : undefined;
      if (layoutSlideId && !layoutPlanSlide) throw parseError;
      const repaired = await deps.callOpenRouterNonStreaming(
        ai.apiKey,
        ai.modelId,
        layoutSlideId && layoutPlanSlide
          ? buildGenerationLayoutRepairMessages({
            ...promptArgs,
            planSlide: layoutPlanSlide,
            slide: presentationSlideRepairTarget(response.content, project.plan, layoutSlideId),
            validationError,
          })
          : buildGenerationRepairMessages({
            ...promptArgs,
            invalidResponse: response.content,
            validationError,
          }),
        withZdrProvider(
          {
            temperature: 0.1,
            includeReasoning: false,
          },
          ai.requireZdr,
        ),
        {
          fallbackModel: MODEL_IDS.appDefault,
          requestTimeoutMs: modelTimeoutMs,
          totalTimeoutMs: modelTimeoutMs,
        },
      );
      parsed = layoutSlideId
        ? applyPresentationLayoutRepair({
          candidateContent: response.content,
          repairContent: repaired.content,
          targetSlideId: layoutSlideId,
          plan: project.plan,
          imageMode: project.imageMode,
          allowedAssetStorageIds: (project.assetStorageIds ?? []).map(String),
        }).deck
        : parsePresentationDeck(
          repaired.content,
          project.plan,
          project.imageMode,
          (project.assetStorageIds ?? []).map(String),
        );
    }
    const completed: ProjectRevisionResult & { slideCount: number } = await ctx.runMutation(
      completeGenerationRef,
      {
        projectId: project._id,
        userId,
        expectedRevision: started.projectRevision,
        slides: parsed.slides,
      },
    );
    return {
      projectId: project._id,
      status: "ready" as const,
      projectRevision: completed.projectRevision,
      slideCount: completed.slideCount,
    };
  } catch (error) {
    if (!(error instanceof DeferredPresentationRepair)) {
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
