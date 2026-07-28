import { z } from "zod";
import {
  MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
  MAX_PRESENTATION_PLAN_LAYOUT_CHARS,
  MAX_PRESENTATION_PLAN_MOTIF_CHARS,
  MAX_PRESENTATION_PLAN_RHYTHM_CHARS,
  MAX_PRESENTATION_SLIDES,
  MAX_TITLE_CHARS,
} from "./limits";
import {
  assertUniqueModelIds,
  invalidModelResponse,
  parseModelWithSchema,
  stableModelId,
} from "./model_json_parsing";
import { compactRepairedPresentationPlan } from "./model_plan_repair";
import {
  defaultPresentationTypographyRoles,
  presentationTypographyRolesSchema,
} from "./model_typography_schema";
import type { ParsedPresentationPlan } from "./types";

function layoutText(value: unknown, depth = 0): string {
  if (depth > 2 || value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) {
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
  return normalized ? normalized.slice(0, MAX_PRESENTATION_PLAN_LAYOUT_CHARS) : value;
}

const planSlideSchema = z.object({
  id: stableModelId,
  title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
  purpose: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_DETAIL_CHARS),
  layout: z.preprocess(
    normalizePresentationLayout,
    z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_LAYOUT_CHARS),
  ),
  imageIntent: z.string().trim().max(MAX_PRESENTATION_PLAN_DETAIL_CHARS),
  focalPoint: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_GUIDANCE_CHARS)
    .default("Primary message"),
  spatialStrategy: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_GUIDANCE_CHARS)
    .default("Purpose-built composition"),
  density: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_LAYOUT_CHARS)
    .default("balanced"),
  visualDevice: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_GUIDANCE_CHARS)
    .default("Typography and geometry"),
  adjacentContrast: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_GUIDANCE_CHARS)
    .default("Change scale and rhythm"),
  avoid: z.string().trim().max(MAX_PRESENTATION_PLAN_GUIDANCE_CHARS)
    .default("Generic repeated card grid"),
}).strip();

const creativeDirectionSchema = z.object({
  palette: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_DETAIL_CHARS),
  typography: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_DETAIL_CHARS),
  typographyRoles: presentationTypographyRolesSchema,
  spacing: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_DETAIL_CHARS),
  shapeLanguage: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_DETAIL_CHARS),
  footerTreatment: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_DETAIL_CHARS),
  motifs: z.array(
    z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_MOTIF_CHARS),
  ).max(8),
  deckRhythm: z.string().trim().min(1).max(MAX_PRESENTATION_PLAN_RHYTHM_CHARS),
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

function parsePlan(
  content: string,
  normalize: (value: unknown) => unknown = (value) => value,
): ParsedPresentationPlan {
  const parsed = parseModelWithSchema(planSchema, content, "planning", normalize);
  assertUniqueModelIds(parsed.slides);
  const uniqueLayouts = new Set(parsed.slides.map((slide) => slide.layout.toLowerCase()));
  if (uniqueLayouts.size < Math.min(parsed.slides.length, 3)) {
    invalidModelResponse("The AI plan repeated one layout instead of varying slide composition.");
  }
  return parsed;
}

export function parsePresentationPlan(content: string): ParsedPresentationPlan {
  return parsePlan(content);
}

export function parseRepairedPresentationPlan(content: string): ParsedPresentationPlan {
  return parsePlan(content, compactRepairedPresentationPlan);
}
