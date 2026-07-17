import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { MODEL_IDS } from "../lib/model_constants";
import { callOpenRouterNonStreaming } from "../lib/openrouter";
import { isZdrEnabled, selectAncillaryModelForZdr } from "../lib/openrouter_zdr";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { getProjectAndSlideInternalRef, getProjectInternalRef } from "./action_refs";
import { normalizeOptionalModelId } from "./limits";
import type { PresentationProjectDoc, PresentationProjectId, PresentationSlideDoc } from "./types";

const defaultPresentationActionDeps = {
  callOpenRouterNonStreaming,
  getRequiredUserOpenRouterApiKey,
  requireAuth,
};

export type PresentationActionDeps = typeof defaultPresentationActionDeps;

export function createPresentationActionDepsForTest(
  overrides: DeepPartial<PresentationActionDeps> = {},
): PresentationActionDeps {
  return mergeTestDeps(defaultPresentationActionDeps, overrides);
}

export async function requireProjectForAction(
  ctx: ActionCtx,
  projectId: PresentationProjectId,
  userId: string,
): Promise<PresentationProjectDoc> {
  const project = await ctx.runQuery(
    getProjectInternalRef,
    { projectId, userId },
  );
  if (!project) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Presentation not found or unauthorized.",
    });
  }
  return project;
}

export async function requireProjectSlideForAction(
  ctx: ActionCtx,
  projectId: PresentationProjectId,
  slideId: string,
  userId: string,
): Promise<{ project: PresentationProjectDoc; slide: PresentationSlideDoc }> {
  const result = await ctx.runQuery(
    getProjectAndSlideInternalRef,
    { projectId, slideId, userId },
  );
  if (!result) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Presentation slide not found or unauthorized.",
    });
  }
  return result;
}

export async function resolvePresentationAiAccess(
  ctx: ActionCtx,
  userId: string,
  requestedModelId: string | undefined,
  requireZdrOverride: boolean | undefined,
  deps: PresentationActionDeps,
): Promise<{ apiKey: string; modelId: string; requireZdr: boolean }> {
  const isPro = await ctx.runQuery(internal.preferences.queries.checkProStatus, { userId });
  if (!isPro) {
    throw new ConvexError({
      code: "PRO_REQUIRED",
      message: "AI presentation generation requires NanthAI Pro.",
    });
  }
  const preferences = await ctx.runQuery(internal.chat.queries.getUserPreferences, { userId });
  const requireZdr = requireZdrOverride === true || isZdrEnabled(preferences);
  const storedDefault = preferences?.defaultModelId?.trim();
  const requested = normalizeOptionalModelId(requestedModelId) ??
    (storedDefault ? normalizeOptionalModelId(storedDefault) : undefined) ??
    MODEL_IDS.appDefault;
  const modelId = selectAncillaryModelForZdr({
    requestedModel: requested,
    defaultModel: MODEL_IDS.appDefault,
    requireZdr,
  });
  const apiKey = await deps.getRequiredUserOpenRouterApiKey(ctx, userId);
  return { apiKey, modelId, requireZdr };
}
