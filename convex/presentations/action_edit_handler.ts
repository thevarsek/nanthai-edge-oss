import type { ActionCtx } from "../_generated/server";
import { MODEL_IDS } from "../lib/model_constants";
import { withZdrProvider } from "../lib/openrouter_zdr";
import {
  type PresentationActionDeps,
  createPresentationActionDepsForTest,
  requireProjectSlideForAction,
  resolvePresentationAiAccess,
} from "./action_shared";
import { applyAiSlideEditRef } from "./action_refs";
import {
  PRESENTATION_MODEL_TIMEOUT_MS,
  assertRevision,
  presentationError,
  safePresentationErrorMessage,
} from "./limits";
import { assertInstruction, parsePresentationEdit } from "./model_parsing";
import { throwRevisionConflict } from "./mutation_helpers";
import { buildEditMessages, buildEditRepairMessages } from "./prompts";
import { loadPresentationPromptAssets } from "./asset_inputs";
import type { EditedSlideResult, PresentationProjectId } from "./types";

export async function applyAiEditHandler(
  ctx: ActionCtx,
  args: {
    projectId: PresentationProjectId;
    slideId: string;
    instruction: string;
    expectedRevision: number;
    modelId?: string;
    requireZdrOverride?: boolean;
    targetElementId?: string;
  },
  deps: PresentationActionDeps = createPresentationActionDepsForTest(),
): Promise<EditedSlideResult> {
  const instruction = assertInstruction(args.instruction);
  assertRevision(args.expectedRevision, "Expected slide revision");
  const { userId } = await deps.requireAuth(ctx);
  const { project, slide } = await requireProjectSlideForAction(
    ctx,
    args.projectId,
    args.slideId,
    userId,
  );
  if (project.status !== "ready") {
    throw presentationError("INVALID_STATE", "Generate this presentation before editing a slide.");
  }
  if (slide.revision !== args.expectedRevision) {
    throwRevisionConflict("slide", slide.revision);
  }
  const ai = await resolvePresentationAiAccess(
    ctx,
    userId,
    args.modelId,
    args.requireZdrOverride,
    deps,
  );
  const assets = await loadPresentationPromptAssets(ctx, project);
  const promptArgs = {
    projectTitle: project.title,
    prompt: project.prompt,
    direction: project.direction,
    imageMode: project.imageMode,
    slide,
    instruction,
    assets,
  };
  const response = await deps.callOpenRouterNonStreaming(
    ai.apiKey,
    ai.modelId,
    buildEditMessages(promptArgs),
    withZdrProvider({ temperature: 0.25, includeReasoning: false }, ai.requireZdr),
    {
      fallbackModel: MODEL_IDS.appDefault,
      requestTimeoutMs: PRESENTATION_MODEL_TIMEOUT_MS,
      totalTimeoutMs: PRESENTATION_MODEL_TIMEOUT_MS,
    },
  );
  const allowedAssetStorageIds = (project.assetStorageIds ?? []).map(String);
  const parse = (content: string) => parsePresentationEdit(
    content,
    slide.html,
    slide.slideId,
    allowedAssetStorageIds,
    slide.title,
    slide.notes,
    args.targetElementId,
  );
  let parsed;
  try {
    parsed = parse(response.content);
  } catch (parseError) {
    const repaired = await deps.callOpenRouterNonStreaming(
      ai.apiKey,
      ai.modelId,
      buildEditRepairMessages({
        ...promptArgs,
        invalidResponse: response.content,
        validationError: safePresentationErrorMessage(parseError),
      }),
      withZdrProvider(
        { temperature: 0.1, includeReasoning: false },
        ai.requireZdr,
      ),
      {
        fallbackModel: MODEL_IDS.appDefault,
        requestTimeoutMs: PRESENTATION_MODEL_TIMEOUT_MS,
        totalTimeoutMs: PRESENTATION_MODEL_TIMEOUT_MS,
      },
    );
    parsed = parse(repaired.content);
  }
  const editedTitle = parsed.title ?? slide.title;
  const editedNotes = parsed.notes ?? slide.notes;
  const revision = await ctx.runMutation(applyAiSlideEditRef, {
    projectId: project._id,
    userId,
    slideId: slide.slideId,
    expectedRevision: args.expectedRevision,
    title: editedTitle,
    notes: editedNotes,
    html: parsed.html,
  });
  const notes = editedNotes?.trim() || undefined;
  return {
    ...revision,
    title: editedTitle,
    ...(notes ? { notes } : {}),
    html: parsed.html,
  };
}
