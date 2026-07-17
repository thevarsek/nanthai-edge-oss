import { MAX_PRESENTATION_SLIDES } from "../presentations/limits";
import type { ToolResult } from "./registry";

export type ApprovedOutlineEntry = { title: string; purpose?: string };

export function requiredPresentationText(
  value: unknown,
  name: string,
): string | ToolResult {
  if (typeof value !== "string" || !value.trim()) {
    return {
      success: false,
      data: null,
      error: `Missing resolved ${name}. Ask the user before creating the presentation.`,
    };
  }
  return value.trim();
}

export function requestedPresentationSlideCount(
  value: unknown,
): number | ToolResult | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_PRESENTATION_SLIDES
  ) {
    return {
      success: false,
      data: { minimum: 1, maximum: MAX_PRESENTATION_SLIDES },
      error:
        `Presentations support 1 to ${MAX_PRESENTATION_SLIDES} slides. ` +
        "Ask the user to consolidate or choose a supported length before creating the deck.",
    };
  }
  return value;
}

export function approvedPresentationOutline(
  value: unknown,
): ApprovedOutlineEntry[] | ToolResult | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PRESENTATION_SLIDES) {
    return {
      success: false,
      data: { minimum: 1, maximum: MAX_PRESENTATION_SLIDES },
      error: `approvedOutline must contain 1 to ${MAX_PRESENTATION_SLIDES} slides.`,
    };
  }
  const outline: ApprovedOutlineEntry[] = [];
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== "object") {
      return {
        success: false,
        data: null,
        error: `approvedOutline item ${index + 1} must be an object.`,
      };
    }
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const purpose = typeof item.purpose === "string" ? item.purpose.trim() : undefined;
    if (!title || title.length > 160 || (purpose?.length ?? 0) > 500) {
      return {
        success: false,
        data: null,
        error:
          `approvedOutline item ${index + 1} needs a title of 1-160 characters ` +
          "and an optional purpose of at most 500 characters.",
      };
    }
    outline.push({ title, ...(purpose ? { purpose } : {}) });
  }
  return outline;
}
