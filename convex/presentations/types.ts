import type { Doc, Id } from "../_generated/dataModel";

export type PresentationDirection = "editorial" | "minimal" | "data_led";
export type PresentationImageMode = "generated" | "references" | "mixed" | "none";
export type PresentationSnapshotKind = "fallback" | "browser_html";
export type PresentationWorkflowPhase =
  | "queued"
  | "planning"
  | "repairing_plan"
  | "generating"
  | "repairing_generation"
  | "exporting"
  | "complete"
  | "failed";
export type PresentationStatus =
  | "draft"
  | "planning"
  | "planned"
  | "generating"
  | "ready"
  | "failed";

export interface PresentationPlanSlide {
  id: string;
  title: string;
  purpose: string;
  layout: string;
  imageIntent: string;
  focalPoint?: string;
  spatialStrategy?: string;
  density?: string;
  visualDevice?: string;
  adjacentContrast?: string;
  avoid?: string;
}

export interface PresentationCreativeDirection {
  palette: string;
  typography: string;
  typographyRoles?: PresentationTypographyRoles;
  spacing: string;
  shapeLanguage: string;
  footerTreatment: string;
  motifs: string[];
  deckRhythm: string;
}

export interface PresentationTypographyToken {
  fontFamily: string;
  fontWeight: number;
}

export interface PresentationTypographyRoles {
  displayTitle: PresentationTypographyToken;
  slideTitle: PresentationTypographyToken;
  body: PresentationTypographyToken;
  label: PresentationTypographyToken;
  kicker: PresentationTypographyToken;
  sequenceNumber: PresentationTypographyToken;
  footer: PresentationTypographyToken;
}

export interface ParsedPresentationPlan {
  schemaVersion: 1;
  title: string;
  creativeDirection: PresentationCreativeDirection;
  slides: PresentationPlanSlide[];
}

export interface ParsedPresentationSlide {
  id: string;
  title: string;
  notes?: string;
  html: string;
}

export interface ParsedPresentationDeck {
  schemaVersion: 1;
  slides: ParsedPresentationSlide[];
}

export interface ParsedPresentationEdit {
  schemaVersion: 1;
  slideId: string;
  title?: string;
  notes?: string;
  operations: PresentationPatchOperation[];
}

export interface ParsedPresentationAppliedEdit extends ParsedPresentationEdit {
  html: string;
}

export type PresentationPatchOperation =
  | { op: "replace_text"; elementId: string; text: string }
  | { op: "set_style"; elementId: string; style: string }
  | { op: "set_attribute"; elementId: string; name: string; value: string }
  | { op: "replace_element"; elementId: string; html: string }
  | { op: "insert_before"; elementId: string; html: string }
  | { op: "insert_after"; elementId: string; html: string }
  | { op: "append_child"; elementId: string; html: string };

export type PresentationProjectDoc = Doc<"presentationProjects">;
export type PresentationSlideDoc = Doc<"presentationSlides">;
export type PresentationProjectId = Id<"presentationProjects">;

export interface ProjectRevisionResult {
  projectId: PresentationProjectId;
  projectRevision: number;
}

export interface SlideRevisionResult extends ProjectRevisionResult {
  slideId: string;
  slideRevision: number;
}

export interface EditedSlideResult extends SlideRevisionResult {
  title: string;
  notes?: string;
  html: string;
}

export interface PlanProjectActionResult extends ProjectRevisionResult {
  status: "planned";
  plan: PresentationPlanSlide[];
}

export interface GenerateProjectActionResult extends ProjectRevisionResult {
  status: "ready";
  slideCount: number;
}
