import {
  MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
  MAX_PRESENTATION_PLAN_MOTIF_CHARS,
  MAX_PRESENTATION_PLAN_RHYTHM_CHARS,
} from "./limits";

const SLIDE_TEXT_LIMITS = {
  purpose: MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  imageIntent: MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  focalPoint: MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
  spatialStrategy: MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
  visualDevice: MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
  adjacentContrast: MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
  avoid: MAX_PRESENTATION_PLAN_GUIDANCE_CHARS,
} as const;

const DIRECTION_TEXT_LIMITS = {
  palette: MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  typography: MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  spacing: MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  shapeLanguage: MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  footerTreatment: MAX_PRESENTATION_PLAN_DETAIL_CHARS,
  deckRhythm: MAX_PRESENTATION_PLAN_RHYTHM_CHARS,
} as const;

function compactText(value: unknown, maxChars: number): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;

  const prefix = normalized.slice(0, maxChars);
  const minimumNaturalBoundary = Math.floor(maxChars * 0.5);
  const sentenceBoundary = Math.max(
    prefix.lastIndexOf("."),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("?"),
    prefix.lastIndexOf(";"),
  );
  if (sentenceBoundary >= minimumNaturalBoundary) {
    return prefix.slice(0, sentenceBoundary + 1).trimEnd();
  }
  const wordBoundary = prefix.lastIndexOf(" ");
  if (wordBoundary >= minimumNaturalBoundary) {
    return prefix.slice(0, wordBoundary).trimEnd();
  }
  return prefix;
}

function compactFields(
  value: unknown,
  limits: Readonly<Record<string, number>>,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [
      key,
      limits[key] === undefined ? entry : compactText(entry, limits[key]),
    ]),
  );
}

export function compactRepairedPresentationPlan(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const plan = value as Record<string, unknown>;
  return {
    ...plan,
    creativeDirection: compactFields(
      compactMotifs(plan.creativeDirection),
      DIRECTION_TEXT_LIMITS,
    ),
    slides: Array.isArray(plan.slides)
      ? plan.slides.map((slide) => compactFields(slide, SLIDE_TEXT_LIMITS))
      : plan.slides,
  };
}

function compactMotifs(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const direction = value as Record<string, unknown>;
  return {
    ...direction,
    motifs: Array.isArray(direction.motifs)
      ? direction.motifs.map((motif) =>
        compactText(motif, MAX_PRESENTATION_PLAN_MOTIF_CHARS))
      : direction.motifs,
  };
}
