import { createTool } from "./registry";
import {
  assertSelectedPresentationRevisions,
  authoritativePresentationTarget,
  resolveOwnedPresentation,
  selectPresentationSlide,
} from "./presentation_tool_shared";

export const readPresentation = createTool({
  name: "read_presentation",
  description:
    "Read a NanthAI presentation's canonical editable HTML and revisions. " +
    "Use an explicit projectId from presentation context, or omit it to read the latest ready presentation in this chat.",
  parameters: {
    type: "object",
    properties: {
      projectId: { type: "string", description: "Presentation project ID. Optional in the originating chat." },
      slideId: { type: "string", description: "Optional stable slide ID to read." },
      slideNumber: { type: "number", description: "Optional 1-based slide number to read." },
    },
  },
  execute: async (toolCtx, args) => {
    try {
      const target = authoritativePresentationTarget(toolCtx, args);
      const presentation = await resolveOwnedPresentation(
        toolCtx,
        target.projectId,
      );
      if (!presentation) {
        return { success: false, data: null, error: "Presentation not found or unauthorized." };
      }
      const requestedSlide = selectPresentationSlide(
        presentation,
        target.slideId,
        target.slideNumber,
      );
      if ((target.slideId !== undefined || target.slideNumber !== undefined) && !requestedSlide) {
        return { success: false, data: null, error: "Presentation slide not found." };
      }
      assertSelectedPresentationRevisions(presentation, target, requestedSlide);
      const slides = requestedSlide ? [requestedSlide] : presentation.slides;
      return {
        success: true,
        data: {
          projectId: presentation.project._id,
          projectRevision: presentation.project.revision,
          title: presentation.project.title,
          brief: presentation.project.prompt,
          direction: presentation.project.direction,
          imageMode: presentation.project.imageMode,
          slides: slides.map((slide) => ({
            slideId: slide.slideId,
            slideNumber: slide.position + 1,
            slideRevision: slide.revision,
            title: slide.title,
            notes: slide.notes,
            html: slide.html,
          })),
        },
      };
    } catch (error) {
      return {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Unable to read presentation.",
      };
    }
  },
});
