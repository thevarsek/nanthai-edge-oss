import type { Id } from "@convex/_generated/dataModel";

export type VideoRole = "first_frame" | "last_frame" | "reference";

export interface AttachmentPreview {
  storageId?: Id<"_storage">;
  url?: string;
  name: string;
  type: string;
  mimeType: string;
  sizeBytes?: number;
  videoRole?: VideoRole;
}
