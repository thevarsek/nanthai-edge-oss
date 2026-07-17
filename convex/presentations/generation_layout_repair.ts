import { presentationError } from "./limits";
import {
  PresentationDeckSlideLayoutError,
  parsePresentationDeck,
  parsePresentationDeckStructure,
  parsePresentationEdit,
} from "./model_parsing";
import { applyDeterministicLayoutAutofix } from "./layout_autofix";
import type {
  ParsedPresentationDeck,
  ParsedPresentationSlide,
  PresentationImageMode,
  PresentationPlanSlide,
} from "./types";

export class PresentationLayoutRepairContinuationError extends Error {
  readonly candidateContent: string;
  readonly layoutError: PresentationDeckSlideLayoutError;

  constructor(candidateContent: string, layoutError: PresentationDeckSlideLayoutError) {
    super(layoutError.message);
    this.name = "PresentationLayoutRepairContinuationError";
    this.candidateContent = candidateContent;
    this.layoutError = layoutError;
  }
}

function invalidResponse(message: string): never {
  throw presentationError("MODEL_RESPONSE_INVALID", message);
}

export function presentationSlideRepairTarget(
  candidateContent: string,
  plan: PresentationPlanSlide[],
  slideId: string,
): ParsedPresentationSlide {
  const deck = parsePresentationDeckStructure(candidateContent, plan);
  const slide = deck.slides.find((entry) => entry.id === slideId);
  if (!slide) invalidResponse(`The slide repair target '${slideId}' was not found.`);
  return slide;
}

export function applyDeterministicPresentationLayoutRepairs(args: {
  candidateContent: string;
  layoutError: PresentationDeckSlideLayoutError;
  plan: PresentationPlanSlide[];
  imageMode: PresentationImageMode;
  allowedAssetStorageIds: readonly string[];
  requireReferenceAsset?: boolean;
}): {
  candidateContent: string;
  deck?: ParsedPresentationDeck;
  layoutError?: PresentationDeckSlideLayoutError;
} | null {
  let candidateContent = args.candidateContent;
  let layoutError = args.layoutError;
  for (let repairIndex = 0; repairIndex < 4; repairIndex += 1) {
    if (!layoutError.issue) return null;
    const candidate = parsePresentationDeckStructure(candidateContent, args.plan);
    const slideIndex = candidate.slides.findIndex((slide) => slide.id === layoutError.slideId);
    const slide = candidate.slides[slideIndex];
    if (!slide) return null;
    const repairedHtml = applyDeterministicLayoutAutofix(slide.html, layoutError.issue);
    if (!repairedHtml) return null;
    const slides = [...candidate.slides];
    slides[slideIndex] = { ...slide, html: repairedHtml };
    candidateContent = JSON.stringify({ ...candidate, slides });
    try {
      return {
        candidateContent,
        deck: parsePresentationDeck(
          candidateContent,
          args.plan,
          args.imageMode,
          args.allowedAssetStorageIds,
          args.requireReferenceAsset ?? true,
        ),
      };
    } catch (error) {
      if (!(error instanceof PresentationDeckSlideLayoutError)) throw error;
      layoutError = error;
    }
  }
  return { candidateContent, layoutError };
}

export function applyPresentationLayoutRepair(args: {
  candidateContent: string;
  repairContent: string;
  targetSlideId: string;
  plan: PresentationPlanSlide[];
  imageMode: PresentationImageMode;
  allowedAssetStorageIds: readonly string[];
  requireReferenceAsset?: boolean;
  allowedElementIds?: readonly string[];
}): { candidateContent: string; deck: ParsedPresentationDeck } {
  const candidate = parsePresentationDeckStructure(args.candidateContent, args.plan);
  const slideIndex = candidate.slides.findIndex((slide) => slide.id === args.targetSlideId);
  const currentSlide = candidate.slides[slideIndex];
  if (!currentSlide) invalidResponse(`The slide repair target '${args.targetSlideId}' was not found.`);
  const repaired = parsePresentationEdit(
    args.repairContent,
    currentSlide.html,
    currentSlide.id,
    args.allowedAssetStorageIds,
    currentSlide.title,
    currentSlide.notes,
  );
  if (repaired.operations.some((operation) => operation.op !== "set_style")) {
    invalidResponse("A generation layout repair may only change existing element styles.");
  }
  const allowedElementIds = new Set(args.allowedElementIds ?? []);
  if (allowedElementIds.size > 0 &&
      repaired.operations.some((operation) => !allowedElementIds.has(operation.elementId))) {
    invalidResponse("A generation layout repair may only change the reported elements.");
  }
  if (
    (repaired.title !== undefined && repaired.title !== currentSlide.title) ||
    (repaired.notes !== undefined && repaired.notes !== (currentSlide.notes ?? ""))
  ) {
    invalidResponse("A generation layout repair may not change slide content or metadata.");
  }
  const slides = [...candidate.slides];
  slides[slideIndex] = { ...currentSlide, html: repaired.html };
  const candidateContent = JSON.stringify({ ...candidate, slides });
  try {
    return {
      candidateContent,
      deck: parsePresentationDeck(
        candidateContent,
        args.plan,
        args.imageMode,
        args.allowedAssetStorageIds,
        args.requireReferenceAsset ?? true,
      ),
    };
  } catch (error) {
    if (error instanceof PresentationDeckSlideLayoutError) {
      throw new PresentationLayoutRepairContinuationError(candidateContent, error);
    }
    throw error;
  }
}
