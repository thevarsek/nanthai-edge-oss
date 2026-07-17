export type PresentationDirection = "editorial" | "minimal" | "data_led";

export type PresentationImageMode =
  | "generated"
  | "references"
  | "mixed"
  | "none";

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
}

export interface PresentationProjectRecord {
  _id: string;
  userId: string;
  title: string;
  status: PresentationStatus;
  sourceKind: "scratch" | "pptx_rebuild";
  prompt: string;
  direction: PresentationDirection;
  imageMode: PresentationImageMode;
  aspectRatio: "16:9";
  revision: number;
  modelId?: string;
  plan?: PresentationPlanSlide[];
  assetStorageIds?: string[];
  snapshotStorageId?: string;
  snapshotRevision?: number;
  snapshotSizeBytes?: number;
  snapshotKind?: "fallback" | "browser_html";
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresentationAssetRecord {
  storageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  altText: string;
  kind: "attachment" | "pptx_extracted";
  url: string;
}

export interface PresentationSlideRecord {
  _id: string;
  userId: string;
  projectId: string;
  slideId: string;
  position: number;
  title: string;
  notes?: string;
  html: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
}

export interface PresentationProjectPayload {
  project: PresentationProjectRecord;
  slides: PresentationSlideRecord[];
  assets: PresentationAssetRecord[];
  snapshotDownloadUrl?: string;
}

export type PresentationAssetUrls = Readonly<Record<string, string>>;

export type PresentationPanelTab = "ai" | "design";
export type PresentationSaveStatus = "idle" | "saving" | "saved" | "error";

export interface PresentationListItem {
  _id: string;
  title: string;
  status: PresentationStatus;
  slideCount: number;
  updatedAt: number;
}
