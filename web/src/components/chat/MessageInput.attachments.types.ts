import type { Id } from "@convex/_generated/dataModel";

export interface AttachmentPreview {
  storageId?: Id<"_storage">;
  url?: string;
  name: string;
  type: string;
  mimeType: string;
  sizeBytes?: number;
}
