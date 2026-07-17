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
  defaultPresentationTypographyRoles,
  presentationTypographyRolesSchema,
} from "./model_typography_schema";
import {
  MAX_INSTRUCTION_CHARS,
  MAX_NOTES_CHARS,
  MAX_PRESENTATION_SLIDES,
  MAX_TITLE_CHARS,
  presentationError,
  safePresentationErrorMessage,
} from "./limits";
import type {
  ParsedPresentationDeck,
  ParsedPresentationAppliedEdit,
  ParsedPresentationPlan,
  PresentationImageMode,
  PresentationPlanSlide,
} from "./types";

const MAX_MODEL_RESPONSE_CHARS = 1_400_000;
const stableId = z.string().trim().min(1).max(64).regex(/^[A-Za-z][A-Za-z0-9_-]*$/);

function layoutText(value: unknown, depth = 0): string {
  if (depth > 2 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map((entry) => layoutText(entry, depth + 1)).filter(Boolean).join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const text = layoutText(entry, depth + 1);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

export function normalizePresentationLayout(value: unknown): unknown {
  const normalized = layoutText(value).replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 100) : value;
}

const planSlideSchema = z.object({
  id: stableId,
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  purpose: z.string().trim().min(1).max(500),
  layout: z.preprocess(
    normalizePresentationLayout,
    z.string().trim().min(1).max(100),
  ),
  imageIntent: z.string().trim().max(500),
  focalPoint: z.string().trim().min(1).max(300).default("Primary message"),
  spatialStrategy: z.string().trim().min(1).max(300).default("Purpose-built composition"),
  density: z.string().trim().min(1).max(100).default("balanced"),
  visualDevice: z.string().trim().min(1).max(300).default("Typography and geometry"),
  adjacentContrast: z.string().trim().min(1).max(300).default("Change scale and rhythm"),
  avoid: z.string().trim().max(300).default("Generic repeated card grid"),
}).strip();
const creativeDirectionSchema = z.object({
  palette: z.string().trim().min(1).max(500),
  typography: z.string().trim().min(1).max(500),
  typographyRoles: presentationTypographyRolesSchema,
  spacing: z.string().trim().min(1).max(500),
  shapeLanguage: z.string().trim().min(1).max(500),
  footerTreatment: z.string().trim().min(1).max(500),
  motifs: z.array(z.string().trim().min(1).max(200)).max(8),
  deckRhythm: z.string().trim().min(1).max(800),
}).strip().default({
  palette: "A restrained, high-contrast palette appropriate to the brief",
  typography: "One display hierarchy with a highly legible body hierarchy",
  typographyRoles: defaultPresentationTypographyRoles,
  spacing: "Consistent generous spacing with deliberate density changes",
  shapeLanguage: "A coherent rule, radius, and line language",
  footerTreatment: "A quiet, consistent footer treatment",
  motifs: ["One recurring graphic motif"],
  deckRhythm: "Alternate scale, density, and composition while preserving cohesion",
});
const planSchema = z.object({
  schemaVersion: z.literal(1),
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  creativeDirection: creativeDirectionSchema,
  slides: z.array(planSlideSchema).min(1).max(MAX_PRESENTATION_SLIDES),
}).strip();
const slideSchema = z.object({
  id: stableId,
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
    elementId: stableId,
    text: z.string().max(20_000),
  }).strict(),
  z.object({
    op: z.literal("set_style"),
    elementId: stableId,
    style: z.string().min(1).max(4_000),
  }).strict(),
  z.object({
    op: z.literal("set_attribute"),
    elementId: stableId,
    name: z.string().trim().min(1).max(64),
    value: z.string().max(4_000),
  }).strict(),
  z.object({ op: z.literal("replace_element"), elementId: stableId, html: patchHtml }).strict(),
  z.object({ op: z.literal("insert_before"), elementId: stableId, html: patchHtml }).strict(),
  z.object({ op: z.literal("insert_after"), elementId: stableId, html: patchHtml }).strict(),
  z.object({ op: z.literal("append_child"), elementId: stableId, html: patchHtml }).strict(),
]);
const editSchema = z.object({
  schemaVersion: z.literal(1),
  slideId: stableId,
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS).optional(),
  notes: z.string().trim().max(MAX_NOTES_CHARS).optional(),
  operations: z.array(patchOperationSchema).min(1).max(30),
}).strict();

function invalidResponse(message: string): never {
  throw presentationError("MODEL_RESPONSE_INVALID", message);
}

export function parseModelJson(content: string): unknown {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  if (!trimmed || trimmed.length > MAX_MODEL_RESPONSE_CHARS) {
    invalidResponse("The AI returned an empty or oversized response.");
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced ?? (() => {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    return start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;
  })();
  try {
    return JSON.parse(candidate);
  } catch {
    invalidResponse("The AI returned malformed JSON. Please try again.");
  }
}

function parseWithSchema<T>(
  schema: z.ZodType<T>,
  content: string,
  label: string,
): T {
  const result = schema.safeParse(parseModelJson(content));
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join(".");
    const reason = issue?.message ? `: ${issue.message}` : "";
    invalidResponse(
      `The AI ${label} response did not match the required contract${path ? ` at ${path}` : ""}${reason}.`,
    );
  }
  return result.data;
}

function assertUniqueSlideIds(slides: Array<{ id: string }>): void {
  const ids = new Set(slides.map((slide) => slide.id));
  if (ids.size !== slides.length) invalidResponse("The AI returned duplicate slide IDs.");
}

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

export function parsePresentationPlan(content: string): ParsedPresentationPlan {
  const parsed = parseWithSchema(planSchema, content, "planning");
  assertUniqueSlideIds(parsed.slides);
  const uniqueLayouts = new Set(parsed.slides.map((slide) => slide.layout.toLowerCase()));
  if (uniqueLayouts.size < Math.min(parsed.slides.length, 3)) {
    invalidResponse("The AI plan repeated one layout instead of varying slide composition.");
  }
  return parsed;
}

export function parsePresentationDeckStructure(
  content: string,
  plan: PresentationPlanSlide[],
): ParsedPresentationDeck {
  const parsed = parseWithSchema(deckSchema, content, "generation");
  assertUniqueSlideIds(parsed.slides);
  if (
    parsed.slides.length !== plan.length ||
    parsed.slides.some((slide, index) => slide.id !== plan[index]?.id)
  ) {
    invalidResponse("The AI deck did not preserve the planned slide IDs and order.");
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
    invalidResponse("The AI deck omitted every reusable reference asset.");
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
  const parsed = parseWithSchema(editSchema, content, "editing");
  if (parsed.slideId !== expectedSlideId) {
    invalidResponse("The AI edit changed the selected slide ID.");
  }
  if (targetElementId &&
      ((parsed.title !== undefined && parsed.title !== currentTitle) ||
       (parsed.notes !== undefined && parsed.notes !== (currentNotes ?? "")))) {
    invalidResponse("An element-targeted edit cannot change slide metadata.");
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
