import type { PresentationPlanSlide } from "./types";
import { MAX_PRESENTATION_STUDIOS } from "./limits";

export interface PresentationStudioBatch {
  batchIndex: number;
  slideIds: string[];
}

export function presentationStudioCount(slideCount: number): number {
  return Math.min(
    MAX_PRESENTATION_STUDIOS,
    Math.max(1, Math.ceil(slideCount / 5)),
  );
}

export function buildPresentationStudioBatches(
  plan: readonly PresentationPlanSlide[],
): PresentationStudioBatch[] {
  const count = presentationStudioCount(plan.length);
  const baseSize = Math.floor(plan.length / count);
  const remainder = plan.length % count;
  let offset = 0;
  return Array.from({ length: count }, (_, batchIndex) => {
    const size = baseSize + (batchIndex < remainder ? 1 : 0);
    const slideIds = plan.slice(offset, offset + size).map((slide) => slide.id);
    offset += size;
    return { batchIndex, slideIds };
  });
}
