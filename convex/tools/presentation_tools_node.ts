"use node";

import type { Id } from "../_generated/dataModel";
import { createChatProjectRef } from "../presentations/action_refs";
import { applyAiEditHandler } from "../presentations/action_edit_handler";
import { createPresentationActionDepsForTest } from "../presentations/action_shared";
import { inspectSlideHtml } from "../presentations/html_contract";
import { MAX_PRESENTATION_SLIDES } from "../presentations/limits";
import type { PresentationDirection, PresentationImageMode } from "../presentations/types";
import { createTool, type ToolExecutionContext } from "./registry";
import {
  assertSelectedPresentationRevisions,
  authoritativePresentationTarget,
  resolveOwnedPresentation,
  selectPresentationSlide,
} from "./presentation_tool_shared";
import {
  optionalPresentationStorageId,
  presentationAssetStorageIds,
} from "./presentation_tool_args";
import { buildResolvedPresentationBrief } from "./presentation_brief";
import { snapshotResult } from "./presentation_snapshot_result";
export { snapshotResult } from "./presentation_snapshot_result";
import {
  approvedPresentationOutline,
  requiredPresentationText,
  requestedPresentationSlideCount,
} from "./presentation_create_args";

function modelDeps(toolCtx: ToolExecutionContext) {
  return createPresentationActionDepsForTest({
    requireAuth: async () => ({ userId: toolCtx.userId }),
  });
}

export const createPresentationNode = createTool({
  name: "create_presentation",
  mayDefer: true,
  description:
    "Create a revisioned NanthAI HTML presentation and a real downloadable PPTX in the current chat. " +
    "Call only after normal chat has resolved audience, tone/technicality, purpose, length, examples or references, reusable assets, and any final ambiguity. " +
    "Keep tool arguments compact: brief contains creative decisions only and must not repeat factual source from the triggering user message; sourceContent is only for source facts that exist in earlier turns. Never invent answers.",
  parameters: {
    type: "object",
    properties: {
      brief: { type: "string", description: "One compact creative/composition brief. Do not copy source facts already present in the triggering user message." },
      audience: { type: "string", description: "Resolved target audience." },
      tone: { type: "string", description: "Resolved tone and technical depth." },
      title: { type: "string", description: "Optional presentation title." },
      objective: { type: "string", description: "Optional desired audience outcome." },
      slideCount: {
        type: "number",
        minimum: 1,
        maximum: MAX_PRESENTATION_SLIDES,
        description: `Optional target slide count, 1 to ${MAX_PRESENTATION_SLIDES}.`,
      },
      approvedOutline: {
        type: "array",
        minItems: 1,
        maxItems: MAX_PRESENTATION_SLIDES,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Approved slide title or topic." },
            purpose: { type: "string", description: "Optional approved narrative purpose." },
          },
          required: ["title"],
          additionalProperties: false,
        },
        description:
          "A slide-by-slide outline already shown to and approved by the user. Preserve its count, order, and topic intent while adding creative composition guidance.",
      },
      direction: { type: "string", description: "editorial, minimal, or data_led." },
      imageMode: { type: "string", description: "generated, references, mixed, or none." },
      referenceNotes: { type: "string", description: "Insights already extracted from examples/references." },
      sourceContent: { type: "string", description: "Factual source to preserve only when it exists in an earlier turn and is absent from the triggering user message. Never duplicate the triggering message." },
      assetStorageIds: { type: "array", items: { type: "string" }, description: "Reusable user-owned asset IDs." },
      sourceStorageId: { type: "string", description: "Attached source PPTX storage ID for a rebuild. A value duplicated in assetStorageIds is treated as a reusable image instead." },
    },
    required: ["brief", "audience", "tone"],
  },
  execute: async (toolCtx, args) => {
    try {
      const brief = requiredPresentationText(args.brief, "brief");
      if (typeof brief !== "string") return brief;
      const audience = requiredPresentationText(args.audience, "audience");
      if (typeof audience !== "string") return audience;
      const tone = requiredPresentationText(args.tone, "tone/technicality");
      if (typeof tone !== "string") return tone;
      const explicitSlideCount = requestedPresentationSlideCount(args.slideCount);
      if (explicitSlideCount && typeof explicitSlideCount !== "number") return explicitSlideCount;
      const resolvedOutline = approvedPresentationOutline(args.approvedOutline);
      if (resolvedOutline && !Array.isArray(resolvedOutline)) return resolvedOutline;
      const slideCount = explicitSlideCount ?? resolvedOutline?.length;
      if (
        explicitSlideCount !== undefined &&
        resolvedOutline !== undefined &&
        explicitSlideCount !== resolvedOutline.length
      ) {
        return {
          success: false,
          data: null,
          error: "slideCount must match the number of slides in approvedOutline.",
        };
      }
      if (!toolCtx.modelId) {
        return { success: false, data: null, error: "No active chat model is available for presentation creation." };
      }
      const direction = (["editorial", "minimal", "data_led"].includes(String(args.direction))
        ? args.direction
        : "editorial") as PresentationDirection;
      const imageMode = (["generated", "references", "mixed", "none"].includes(String(args.imageMode))
        ? args.imageMode
        : "none") as PresentationImageMode;
      const assetStorageIds = presentationAssetStorageIds(args.assetStorageIds);
      const requestedSourceStorageId = optionalPresentationStorageId(args.sourceStorageId);
      const sourceStorageId = requestedSourceStorageId && assetStorageIds?.includes(requestedSourceStorageId)
        ? undefined
        : requestedSourceStorageId;
      const prompt = await buildResolvedPresentationBrief(
        toolCtx,
        { ...args, assetStorageIds, slideCount, approvedOutline: resolvedOutline },
        brief,
        audience,
        tone,
      );
      const projectId = await toolCtx.ctx.runMutation(createChatProjectRef, {
        userId: toolCtx.userId,
        chatId: toolCtx.chatId as Id<"chats"> | undefined,
        originUserMessageId: toolCtx.userMessageId as Id<"messages"> | undefined,
        originAssistantMessageId: toolCtx.messageId as Id<"messages"> | undefined,
        originToolCallId: toolCtx.toolCallId,
        sourceStorageId,
        assetStorageIds,
        title: typeof args.title === "string" ? args.title : undefined,
        prompt,
        direction,
        imageMode,
      });
      if (!toolCtx.jobId) {
        return {
          success: false,
          data: { presentationProjectId: projectId },
          error: "Presentation creation requires an active chat generation job.",
        };
      }
      return {
        success: true,
        data: {
          status: "generating",
          presentationProjectId: projectId,
          message: "Presentation generation is continuing in durable phases.",
        },
        deferred: {
          kind: "presentation_workflow",
          data: { projectId },
        },
      };
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : "Presentation creation failed." };
    }
  },
});

export const editPresentationNode = createTool({
  name: "edit_presentation",
  description:
    "Surgically edit one slide (optionally one stable HTML element) in a NanthAI presentation, then emit an updated real PPTX. " +
    "Use project/slide/element IDs from hidden presentation context; omit projectId only to use the latest ready presentation in this chat.",
  parameters: {
    type: "object",
    properties: {
      instruction: { type: "string", description: "Specific requested change; preserve everything else." },
      projectId: { type: "string", description: "Optional presentation project ID." },
      projectRevision: { type: "number", description: "Optional expected project revision from UI context." },
      slideId: { type: "string", description: "Stable slide ID." },
      slideNumber: { type: "number", description: "1-based slide number if no slide ID is available." },
      slideRevision: { type: "number", description: "Optional expected slide revision from UI context." },
      elementId: { type: "string", description: "Optional stable data-element-id to scope the edit." },
    },
    required: ["instruction"],
  },
  execute: async (toolCtx, args) => {
    try {
      const instruction = requiredPresentationText(args.instruction, "edit instruction");
      if (typeof instruction !== "string") return instruction;
      if (!toolCtx.modelId) {
        return { success: false, data: null, error: "No active chat model is available for presentation editing." };
      }
      const target = authoritativePresentationTarget(toolCtx, args);
      const presentation = await resolveOwnedPresentation(
        toolCtx,
        target.projectId,
        { requireUnambiguous: true },
      );
      if (!presentation) return { success: false, data: null, error: "Presentation not found or unauthorized." };
      const slide = selectPresentationSlide(
        presentation,
        target.slideId,
        target.slideNumber,
      );
      if (!slide) return { success: false, data: null, error: "Choose a slide by slideId or slideNumber before editing." };
      assertSelectedPresentationRevisions(presentation, target, slide);
      let scopedInstruction = instruction;
      if (target.elementId) {
        const elementId = target.elementId;
        if (!inspectSlideHtml(slide.html, presentation.project.assetStorageIds ?? []).elementIds.has(elementId)) {
          return { success: false, data: null, error: `Element ${elementId} was not found on the selected slide.` };
        }
        scopedInstruction = `Only change the element with data-element-id="${elementId}" (and the minimum surrounding layout needed). ${instruction}`;
      }
      const edited = await applyAiEditHandler(toolCtx.ctx, {
        projectId: presentation.project._id,
        slideId: slide.slideId,
        instruction: scopedInstruction,
        expectedRevision: slide.revision,
        modelId: toolCtx.modelId,
        requireZdrOverride: toolCtx.requireZdr,
        targetElementId: target.elementId,
      }, modelDeps(toolCtx));
      return await snapshotResult(
        toolCtx,
        presentation.project._id,
        edited.projectRevision,
        "edit_presentation",
      );
    } catch (error) {
      return { success: false, data: null, error: error instanceof Error ? error.message : "Presentation edit failed." };
    }
  },
});
