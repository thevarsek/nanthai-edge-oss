import { ConvexError } from "convex/values";
import { z } from "zod";
import { inspectSlideHtml } from "./html_contract";
import {
  GeneratedSlideLayoutError,
  type GeneratedSlideLayoutIssue,
  validateGeneratedSlideLayout,
} from "./generated_layout_validation";
import { applyPresentationPatch } from "./patch_operations";
import {
  MAX_INSTRUCTION_CHARS,
  MAX_NOTES_CHARS,
  MAX_PRESENTATION_SLIDES,
  MAX_TITLE_CHARS,
  safePresentationErrorMessage,
} from "./limits";
import {
  assertUniqueModelIds,
  invalidModelResponse,
  parseModelWithSchema,
  stableModelId,
} from "./model_json_parsing";
import type {
  ParsedPresentationDeck,
  ParsedPresentationAppliedEdit,
  PresentationImageMode,
  PresentationPlanSlide,
} from "./types";

export { parseModelJson } from "./model_json_parsing";
export {
  normalizePresentationLayout,
  parsePresentationPlan,
  parseRepairedPresentationPlan,
} from "./model_plan_parsing";

const slideSchema = z.object({
  id: stableModelId,
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  notes: z.string().trim().max(MAX_NOTES_CHARS).optional(),
  html: z.string().min(1),
}).strict();
const deckSchema = z.object({
  schemaVersion: z.literal(1),
  slides: z.array(slideSchema).min(1).max(MAX_PRESENTATION_SLIDES),
}).strict();
const patchHtml = z.string().min(1).max(100_000);
const patchOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("replace_text"),
    elementId: stableModelId,
    text: z.string().max(20_000),
  }).strict(),
  z.object({
    op: z.literal("set_style"),
    elementId: stableModelId,
    style: z.string().min(1).max(4_000),
  }).strict(),
  z.object({
    op: z.literal("set_attribute"),
    elementId: stableModelId,
    name: z.string().trim().min(1).max(64),
    value: z.string().max(4_000),
  }).strict(),
  z.object({ op: z.literal("replace_element"), elementId: stableModelId, html: patchHtml }).strict(),
  z.object({ op: z.literal("insert_before"), elementId: stableModelId, html: patchHtml }).strict(),
  z.object({ op: z.literal("insert_after"), elementId: stableModelId, html: patchHtml }).strict(),
  z.object({ op: z.literal("append_child"), elementId: stableModelId, html: patchHtml }).strict(),
]);
const editSchema = z.object({
  schemaVersion: z.literal(1),
  slideId: stableModelId,
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS).optional(),
  notes: z.string().trim().max(MAX_NOTES_CHARS).optional(),
  operations: z.array(patchOperationSchema).min(1).max(30),
}).strict();

export class PresentationDeckSlideLayoutError extends Error {
  readonly slideId: string;
  readonly issue?: GeneratedSlideLayoutIssue;
  readonly issues?: readonly GeneratedSlideLayoutIssue[];

  constructor(slideId: string, validationError: unknown) {
    super(safePresentationErrorMessage(validationError));
    this.name = "PresentationDeckSlideLayoutError";
    this.slideId = slideId;
    this.issue = validationError instanceof GeneratedSlideLayoutError
      ? validationError.issue
      : undefined;
    this.issues = validationError instanceof GeneratedSlideLayoutError
      ? validationError.issues
      : undefined;
  }
}

export function parsePresentationDeckStructure(
  content: string,
  plan: PresentationPlanSlide[],
): ParsedPresentationDeck {
  const parsed = parseModelWithSchema(deckSchema, content, "generation");
  assertUniqueModelIds(parsed.slides);
  if (
    parsed.slides.length !== plan.length ||
    parsed.slides.some((slide, index) => slide.id !== plan[index]?.id)
  ) {
    invalidModelResponse("The AI deck did not preserve the planned slide IDs and order.");
  }
  return parsed;
}

export function parsePresentationDeck(
  content: string,
  plan: PresentationPlanSlide[],
  imageMode: PresentationImageMode,
  allowedAssetStorageIds: readonly string[] = [],
  requireReferenceAsset = true,
  layoutPolicy: "validate" | "release" = "validate",
): ParsedPresentationDeck {
  const parsed = parsePresentationDeckStructure(content, plan);
  const usedAssetStorageIds = new Set<string>();
  const slides = parsed.slides.map((slide) => {
    const inspected = inspectSlideHtml(slide.html, allowedAssetStorageIds);
    if (layoutPolicy === "validate") {
      try {
        validateGeneratedSlideLayout(inspected.html);
      } catch (error) {
        throw new PresentationDeckSlideLayoutError(slide.id, error);
      }
    }
    for (const storageId of inspected.usedAssetStorageIds) {
      usedAssetStorageIds.add(storageId);
    }
    return { ...slide, html: inspected.html };
  });
  if (requireReferenceAsset && (imageMode === "references" || imageMode === "mixed") &&
      allowedAssetStorageIds.length > 0 && usedAssetStorageIds.size === 0) {
    invalidModelResponse("The AI deck omitted every reusable reference asset.");
  }
  return { ...parsed, slides };
}

export function parsePresentationEdit(
  content: string,
  currentHtml: string,
  expectedSlideId: string,
  allowedAssetStorageIds: readonly string[],
  currentTitle: string,
  currentNotes?: string,
  targetElementId?: string,
): ParsedPresentationAppliedEdit {
  const parsed = parseModelWithSchema(editSchema, content, "editing");
  if (parsed.slideId !== expectedSlideId) {
    invalidModelResponse("The AI edit changed the selected slide ID.");
  }
  if (targetElementId &&
      ((parsed.title !== undefined && parsed.title !== currentTitle) ||
       (parsed.notes !== undefined && parsed.notes !== (currentNotes ?? "")))) {
    invalidModelResponse("An element-targeted edit cannot change slide metadata.");
  }
  return {
    ...parsed,
    html: applyPresentationPatch({
      currentHtml,
      operations: parsed.operations,
      allowedAssetStorageIds,
      targetElementId,
    }),
  };
}

export function assertInstruction(instruction: string): string {
  const normalized = instruction.trim();
  if (!normalized || normalized.length > MAX_INSTRUCTION_CHARS) {
    throw new ConvexError({
      code: "VALIDATION",
      message: `Edit instructions must be between 1 and ${MAX_INSTRUCTION_CHARS.toLocaleString()} characters.`,
    });
  }
  return normalized;
}
