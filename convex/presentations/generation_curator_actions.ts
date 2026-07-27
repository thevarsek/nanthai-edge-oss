"use node";

import { internalAction, type ActionCtx } from "../_generated/server";
import { v } from "convex/values";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import { createPresentationActionDepsForTest, resolvePresentationAiAccess } from "./action_shared";
import { loadPresentationPromptAssets } from "./asset_inputs";
import {
  consolidationPreservesContent,
  presentationCompositionFingerprint,
  presentationVisibleText,
} from "./curation_analysis";
import {
  claimPresentationCuratorTaskRef,
  completePresentationCuratorTaskRef,
  retryPresentationCuratorTaskRef,
  type PresentationCuratorContext,
} from "./generation_fanout_refs";
import { presentationGenerationJobIsActive } from "./generation_workflow_active";
import {
  PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
  safePresentationErrorMessage,
} from "./limits";
import { parsePresentationDeck, parsePresentationEdit } from "./model_parsing";
import { buildEditMessages } from "./prompts";
import {
  buildStudioGenerationMessages,
  curatorConsolidationInstruction,
  curatorRecomposeInstruction,
} from "./studio_prompts";
import { presentationExecutionIdentity } from "./generation_execution_identity";
import { presentationCuratorTaskActionContext } from
  "./generation_curator_action_context";

const taskArgs = {
  taskId: v.id("presentationCuratorTasks"),
  executionAttemptId: v.id("executionAttempts"),
  executionFence: v.number(),
};

function taskCandidates(context: PresentationCuratorContext & {
  task: PresentationCuratorContext["tasks"][number];
}) {
  const ids = new Set(context.task.slideIds);
  return context.candidates.filter((candidate) => ids.has(candidate.slideId));
}

async function completeTaskWithoutChange(
  ctx: ActionCtx,
  context: PresentationCuratorContext & {
    task: PresentationCuratorContext["tasks"][number];
  },
  error?: string,
): Promise<void> {
  await ctx.runMutation(completePresentationCuratorTaskRef, {
    taskId: context.task._id,
    ...presentationExecutionIdentity(context.run),
    slides: [],
    deleteSlideIds: [],
    ...(error ? { error: error.slice(0, 500) } : {}),
  });
}

export const runPresentationCuratorTask = internalAction({
  args: taskArgs,
  handler: async (ctx, args): Promise<void> => {
    const context = await presentationCuratorTaskActionContext(ctx, args);
    if (!context) return;
    if (!(await presentationGenerationJobIsActive(ctx, context.run.jobId))) return;
    if (!(await ctx.runMutation(claimPresentationCuratorTaskRef, {
      taskId: context.task._id,
      ...presentationExecutionIdentity(context.run),
    }))) return;
    const candidates = taskCandidates(context);
    if (candidates.length !== context.task.slideIds.length) {
      await completeTaskWithoutChange(ctx, context, "Curator candidates were incomplete.");
      return;
    }
    const survivor = candidates[0];
    if (!survivor) {
      await completeTaskWithoutChange(ctx, context, "Curator target was missing.");
      return;
    }
    if (context.task.kind === "consolidate" &&
        consolidationPreservesContent(candidates, survivor)) {
      await ctx.runMutation(completePresentationCuratorTaskRef, {
        taskId: context.task._id,
        ...presentationExecutionIdentity(context.run),
        slides: [],
        deleteSlideIds: candidates.slice(1).map((candidate) => candidate.slideId),
      });
      return;
    }
    try {
      const result = context.task.mode === "recreate"
        ? await recreateCandidate(ctx, context, candidates)
        : await patchCandidate(ctx, context, candidates);
      const canDelete = context.task.kind === "consolidate" &&
        consolidationPreservesContent(candidates, {
          slideId: result.slide.id,
          title: result.slide.title,
          notes: result.slide.notes,
          html: result.slide.html,
        });
      const repeatsComposition = context.task.kind === "recompose" &&
        context.candidates.some((candidate) =>
          candidate.slideId !== result.slide.id &&
          presentationCompositionFingerprint(candidate.html) ===
            presentationCompositionFingerprint(result.slide.html)
        );
      if (repeatsComposition) {
        if (context.task.mode === "patch") {
          await retryTask(ctx, context, "recreate", result.effectiveModelId,
            "Component patch retained a duplicate composition.");
        } else {
          await completeTaskWithoutChange(ctx, context,
            "Recreation remained compositionally repetitive; the validated original was kept.");
        }
        return;
      }
      if (context.task.kind === "consolidate" && !canDelete) {
        if (context.task.mode === "patch") {
          await retryTask(ctx, context, "recreate", result.effectiveModelId,
            "Component patch did not retain all duplicate content.");
        } else {
          await completeTaskWithoutChange(ctx, context,
            "Recreation could not prove complete duplicate-content retention; both slides were kept.");
        }
        return;
      }
      await ctx.runMutation(completePresentationCuratorTaskRef, {
        taskId: context.task._id,
        ...presentationExecutionIdentity(context.run),
        slides: [result.slide],
        deleteSlideIds: canDelete
          ? candidates.slice(1).map((candidate) => candidate.slideId)
          : [],
        effectiveModelId: result.effectiveModelId,
      });
    } catch (error) {
      if (context.task.mode === "patch") {
        await retryTask(ctx, context, "recreate", undefined, safePresentationErrorMessage(error));
      } else {
        await completeTaskWithoutChange(ctx, context,
          `Curator kept the safe original after recreation failed: ${safePresentationErrorMessage(error)}`);
      }
    }
  },
});

async function retryTask(
  ctx: ActionCtx,
  context: PresentationCuratorContext & {
    task: PresentationCuratorContext["tasks"][number];
  },
  mode: "patch" | "recreate",
  effectiveModelId: string | undefined,
  error: string,
): Promise<void> {
  await ctx.runMutation(retryPresentationCuratorTaskRef, {
    taskId: context.task._id,
    ...presentationExecutionIdentity(context.run),
    mode,
    attempt: context.task.attempt + 1,
    error,
    ...(effectiveModelId ? { effectiveModelId } : {}),
  });
}

async function modelAccess(ctx: ActionCtx, context: {
  run: { userId: string; selectedModelId: string; requireZdrOverride?: boolean };
}) {
  const deps = createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: context.run.userId }),
  });
  const ai = await resolvePresentationAiAccess(
    ctx, context.run.userId, context.run.selectedModelId,
    context.run.requireZdrOverride, deps,
  );
  return { deps, ai };
}

async function patchCandidate(
  ctx: ActionCtx,
  context: PresentationCuratorContext & { task: PresentationCuratorContext["tasks"][number] },
  candidates: PresentationCuratorContext["candidates"],
) {
  const survivor = candidates[0];
  if (!survivor) throw new Error("Curator target was missing.");
  const { deps, ai } = await modelAccess(ctx, context);
  const assets = await loadPresentationPromptAssets(ctx, context.project);
  const plan = context.project.plan ?? [];
  const index = plan.findIndex((slide) => slide.id === survivor.slideId);
  const instruction = context.task.kind === "consolidate"
    ? curatorConsolidationInstruction({
      survivorSlideId: survivor.slideId,
      duplicateSlides: candidates.map((candidate) => ({
        slideId: candidate.slideId,
        title: candidate.title,
        notes: candidate.notes,
        text: presentationVisibleText(candidate),
      })),
    })
    : curatorRecomposeInstruction({
      slideId: survivor.slideId,
      neighboringPlan: plan.slice(Math.max(0, index - 1), index + 2),
    });
  const response = await deps.callOpenRouterNonStreaming(
    ai.apiKey, ai.modelId,
    buildEditMessages({
      projectTitle: context.project.title,
      prompt: context.project.prompt,
      direction: context.project.direction,
      imageMode: context.project.imageMode,
      slide: survivor,
      instruction,
      assets,
    }),
    withZdrProvider({ temperature: 0.35, includeReasoning: false }, ai.requireZdr),
    {
      fallbackModel: MODEL_IDS.appDefault,
      requestTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
      totalTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
    },
  );
  const parsed = parsePresentationEdit(
    response.content,
    survivor.html,
    survivor.slideId,
    (context.project.assetStorageIds ?? []).map(String),
    survivor.title,
    survivor.notes,
  );
  return {
    slide: {
      id: survivor.slideId,
      title: parsed.title ?? survivor.title,
      notes: parsed.notes ?? survivor.notes,
      html: parsed.html,
    },
    effectiveModelId: response.modelId ?? ai.modelId,
  };
}

async function recreateCandidate(
  ctx: ActionCtx,
  context: PresentationCuratorContext & { task: PresentationCuratorContext["tasks"][number] },
  candidates: PresentationCuratorContext["candidates"],
) {
  const survivor = candidates[0];
  if (!survivor) throw new Error("Curator target was missing.");
  const { deps, ai } = await modelAccess(ctx, context);
  const assets = await loadPresentationPromptAssets(ctx, context.project);
  const messages = buildStudioGenerationMessages({
    title: context.project.title,
    prompt: context.project.prompt,
    direction: context.project.direction,
    imageMode: context.project.imageMode,
    plan: context.project.plan ?? [],
    targetSlideIds: [survivor.slideId],
    creativeDirection: context.project.creativeDirection,
    assets,
  });
  if (context.task.kind === "consolidate") {
    messages.push({
      role: "user",
      content: `Recreation is necessary because component patching could not retain all content. Preserve these materials exactly: ${JSON.stringify(candidates.map((candidate) => presentationVisibleText(candidate)))}`,
    });
  }
  const response = await deps.callOpenRouterNonStreaming(
    ai.apiKey, ai.modelId, messages,
    withZdrProvider({ temperature: 0.55, includeReasoning: false }, ai.requireZdr),
    {
      fallbackModel: MODEL_IDS.appDefault,
      requestTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
      totalTimeoutMs: PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS,
    },
  );
  const planSlide = (context.project.plan ?? []).filter((slide) => slide.id === survivor.slideId);
  const deck = parsePresentationDeck(
    response.content,
    planSlide,
    context.project.imageMode,
    (context.project.assetStorageIds ?? []).map(String),
    false,
    "release",
  );
  const slide = deck.slides[0];
  if (!slide) throw new Error("Curator recreation returned no slide.");
  return { slide, effectiveModelId: response.modelId ?? ai.modelId };
}
