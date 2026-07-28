import { ConvexError } from "convex/values";
import type { PresentationStatus } from "./types";

export const MAX_PRESENTATION_SLIDES = 20;
export const MAX_PRESENTATION_STUDIOS = 4;
export const MAX_PROJECTS_PER_USER = 100;
export const MAX_HTML_BYTES = 100 * 1024;
export const MAX_PROMPT_CHARS = 60_000;
export const MAX_INSTRUCTION_CHARS = 4_000;
export const MAX_TITLE_CHARS = 160;
export const MAX_NOTES_CHARS = 5_000;
export const MAX_PRESENTATION_PLAN_LAYOUT_CHARS = 100;
export const MAX_PRESENTATION_PLAN_GUIDANCE_CHARS = 300;
export const MAX_PRESENTATION_PLAN_DETAIL_CHARS = 500;
export const MAX_PRESENTATION_PLAN_RHYTHM_CHARS = 800;
export const MAX_PRESENTATION_PLAN_MOTIF_CHARS = 200;
export const MAX_MODEL_ID_CHARS = 240;
export const MAX_PRESENTATION_ASSETS = 24;
export const MAX_PRESENTATION_ASSET_BYTES = 12 * 1024 * 1024;
export const MAX_PRESENTATION_SNAPSHOT_BYTES = 50 * 1024 * 1024;
// Inline actions retain a bounded initial + repair pair below Convex's
// ten-minute Node action ceiling.
export const PRESENTATION_MODEL_TIMEOUT_MS = 4 * 60 * 1_000;
// Chat creation schedules every initial/repair request as its own action, so a
// single slow provider request can use a larger share of the action allowance.
// Reserve one full minute below Convex's ten-minute action ceiling for response
// parsing, validation, persistence, and cancellation cleanup.
export const PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS = 9 * 60 * 1_000;
export const MAX_PRESENTATION_WORKFLOW_MODEL_PHASES = 5;
// Layout repairs stay slide-local and stop after three model passes. A safe
// candidate is released after this point even if advisory layout issues remain.
export const MAX_PRESENTATION_GENERATION_REPAIR_ATTEMPTS = 3;
export const PRESENTATION_WORKFLOW_LEASE_MS =
  PRESENTATION_DEFERRED_MODEL_TIMEOUT_MS + 60 * 1_000;

export function presentationError(
  code: string,
  message: string,
): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code, message });
}

export function requireBoundedText(
  value: string,
  label: string,
  maxChars: number,
): string {
  const normalized = value.trim();
  if (!normalized) {
    throw presentationError("VALIDATION", `${label} is required.`);
  }
  if (normalized.length > maxChars) {
    throw presentationError(
      "VALIDATION",
      `${label} must be ${maxChars.toLocaleString()} characters or fewer.`,
    );
  }
  return normalized;
}

export function normalizeOptionalModelId(modelId?: string): string | undefined {
  if (modelId == null) return undefined;
  return requireBoundedText(modelId, "Model ID", MAX_MODEL_ID_CHARS);
}

export function assertRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw presentationError(
      "VALIDATION",
      `${label} must be a non-negative integer.`,
    );
  }
}

export function assertPosition(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw presentationError(
      "MODEL_RESPONSE_INVALID",
      "The AI returned an invalid slide position.",
    );
  }
}

export function assertProjectCanBeEdited(status: PresentationStatus): void {
  if (status === "planning" || status === "generating") {
    throw presentationError(
      "PROJECT_BUSY",
      "This presentation is currently being generated. Try again when it finishes.",
    );
  }
}

export function safePresentationErrorMessage(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: unknown } | undefined;
    if (typeof data?.message === "string" && data.message.trim()) {
      return data.message.trim().slice(0, 500);
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim().slice(0, 500);
  }
  return "Presentation generation failed. Please try again.";
}
