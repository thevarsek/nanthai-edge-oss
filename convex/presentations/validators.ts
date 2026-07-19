import { v } from "convex/values";

export const presentationStatusValidator = v.union(
  v.literal("draft"),
  v.literal("planning"),
  v.literal("planned"),
  v.literal("generating"),
  v.literal("ready"),
  v.literal("failed"),
);

export const presentationWorkflowPhaseValidator = v.union(
  v.literal("queued"),
  v.literal("planning"),
  v.literal("repairing_plan"),
  v.literal("generating"),
  v.literal("repairing_generation"),
  v.literal("exporting"),
  v.literal("complete"),
  v.literal("failed"),
);

export const presentationSourceKindValidator = v.union(
  v.literal("scratch"),
  v.literal("pptx_rebuild"),
);

export const presentationDirectionValidator = v.union(
  v.literal("editorial"),
  v.literal("minimal"),
  v.literal("data_led"),
);

export const presentationImageModeValidator = v.union(
  v.literal("generated"),
  v.literal("references"),
  v.literal("mixed"),
  v.literal("none"),
);

/** Precise presentation selection carried by a user chat message. */
export const presentationContextValidator = v.object({
  projectId: v.id("presentationProjects"),
  projectRevision: v.number(),
  slideId: v.optional(v.string()),
  slideRevision: v.optional(v.number()),
  elementId: v.optional(v.string()),
});

export const presentationPlanSlideValidator = v.object({
  id: v.string(),
  title: v.string(),
  purpose: v.string(),
  layout: v.string(),
  imageIntent: v.string(),
  focalPoint: v.optional(v.string()),
  spatialStrategy: v.optional(v.string()),
  density: v.optional(v.string()),
  visualDevice: v.optional(v.string()),
  adjacentContrast: v.optional(v.string()),
  avoid: v.optional(v.string()),
});

export const presentationCreativeDirectionValidator = v.object({
  palette: v.string(),
  typography: v.string(),
  typographyRoles: v.optional(v.object({
    displayTitle: v.object({ fontFamily: v.string(), fontWeight: v.number() }),
    slideTitle: v.object({ fontFamily: v.string(), fontWeight: v.number() }),
    body: v.object({ fontFamily: v.string(), fontWeight: v.number() }),
    label: v.object({ fontFamily: v.string(), fontWeight: v.number() }),
    kicker: v.object({ fontFamily: v.string(), fontWeight: v.number() }),
    sequenceNumber: v.object({ fontFamily: v.string(), fontWeight: v.number() }),
    footer: v.object({ fontFamily: v.string(), fontWeight: v.number() }),
  })),
  spacing: v.string(),
  shapeLanguage: v.string(),
  footerTreatment: v.string(),
  motifs: v.array(v.string()),
  deckRhythm: v.string(),
});

export const presentationPlanValidator = v.array(
  presentationPlanSlideValidator,
);

export const presentationProjectDocValidator = v.object({
  _id: v.id("presentationProjects"),
  _creationTime: v.number(),
  userId: v.string(),
  chatId: v.optional(v.id("chats")),
  originUserMessageId: v.optional(v.id("messages")),
  originAssistantMessageId: v.optional(v.id("messages")),
  originToolCallId: v.optional(v.string()),
  sourceStorageId: v.optional(v.id("_storage")),
  assetStorageIds: v.optional(v.array(v.id("_storage"))),
  title: v.string(),
  status: presentationStatusValidator,
  workflowPhase: v.optional(presentationWorkflowPhaseValidator),
  sourceKind: presentationSourceKindValidator,
  prompt: v.string(),
  direction: presentationDirectionValidator,
  imageMode: presentationImageModeValidator,
  aspectRatio: v.literal("16:9"),
  revision: v.number(),
  modelId: v.optional(v.string()),
  effectiveModelIds: v.optional(v.array(v.string())),
  modelFallbackUsed: v.optional(v.boolean()),
  plan: v.optional(presentationPlanValidator),
  creativeDirection: v.optional(presentationCreativeDirectionValidator),
  snapshotStorageId: v.optional(v.id("_storage")),
  snapshotRevision: v.optional(v.number()),
  snapshotSizeBytes: v.optional(v.number()),
  snapshotKind: v.optional(v.union(v.literal("fallback"), v.literal("browser_html"))),
  workflowId: v.optional(v.string()),
  parentResumeEventId: v.optional(v.string()),
  executionRunId: v.optional(v.id("executionRuns")),
  executionAttemptId: v.optional(v.id("executionAttempts")),
  executionFence: v.optional(v.number()),
  error: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const presentationAssetDocValidator = v.object({
  _id: v.id("presentationAssets"),
  _creationTime: v.number(),
  userId: v.string(),
  projectId: v.optional(v.id("presentationProjects")),
  sourceStorageId: v.optional(v.id("_storage")),
  storageId: v.id("_storage"),
  filename: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  altText: v.string(),
  kind: v.union(v.literal("attachment"), v.literal("pptx_extracted")),
  createdAt: v.number(),
});

export const presentationAssetPayloadValidator = v.object({
  storageId: v.id("_storage"),
  filename: v.string(),
  mimeType: v.string(),
  sizeBytes: v.number(),
  altText: v.string(),
  kind: v.union(v.literal("attachment"), v.literal("pptx_extracted")),
  url: v.string(),
});

export const presentationSlideDocValidator = v.object({
  _id: v.id("presentationSlides"),
  _creationTime: v.number(),
  userId: v.string(),
  projectId: v.id("presentationProjects"),
  slideId: v.string(),
  position: v.number(),
  title: v.string(),
  notes: v.optional(v.string()),
  html: v.string(),
  revision: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const presentationProjectWithSlidesValidator = v.object({
  project: presentationProjectDocValidator,
  slides: v.array(presentationSlideDocValidator),
});

export const presentationProjectPayloadValidator = v.object({
  project: presentationProjectDocValidator,
  slides: v.array(presentationSlideDocValidator),
  assets: v.array(presentationAssetPayloadValidator),
  snapshotDownloadUrl: v.optional(v.string()),
});

export const projectRevisionResultValidator = v.object({
  projectId: v.id("presentationProjects"),
  projectRevision: v.number(),
});

export const slideRevisionResultValidator = v.object({
  projectId: v.id("presentationProjects"),
  projectRevision: v.number(),
  slideId: v.string(),
  slideRevision: v.number(),
});

export const editedSlideResultValidator = v.object({
  projectId: v.id("presentationProjects"),
  projectRevision: v.number(),
  slideId: v.string(),
  slideRevision: v.number(),
  title: v.string(),
  notes: v.optional(v.string()),
  html: v.string(),
});
