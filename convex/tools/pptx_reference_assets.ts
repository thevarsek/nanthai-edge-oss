import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { PptxEmbeddedImage, PptxGeometry } from "./pptx_reference_traits";
import type { ToolExecutionContext } from "./registry";

export interface StoredPptxReferenceImage {
  storageId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  slideNumbers: number[];
  placements: PptxGeometry[];
}

export async function storePptxReferenceImages(
  toolCtx: ToolExecutionContext,
  sourceStorageId: Id<"_storage">,
  images: PptxEmbeddedImage[],
): Promise<StoredPptxReferenceImage[]> {
  const stored: StoredPptxReferenceImage[] = [];
  for (const image of images) {
    if (!image.mimeType.startsWith("image/") || image.data.byteLength === 0) continue;
    const newStorageId = await toolCtx.ctx.storage.store(
      new Blob([Uint8Array.from(image.data).buffer], { type: image.mimeType }),
    );
    const storageId = await toolCtx.ctx.runMutation(
      internal.presentations.mutations_internal.registerReferenceAsset,
      {
        userId: toolCtx.userId,
        sourceStorageId,
        storageId: newStorageId,
        filename: image.filename,
        mimeType: image.mimeType,
        sizeBytes: image.data.byteLength,
        altText: `Image extracted from ${image.slideNumbers
          .map((slideNumber) => `slide ${slideNumber}`)
          .join(", ")}`,
      },
    );
    if (storageId !== newStorageId) {
      try {
        await toolCtx.ctx.storage.delete(newStorageId);
      } catch {
        // Best-effort duplicate cleanup.
      }
    }
    stored.push({
      storageId: String(storageId),
      filename: image.filename,
      mimeType: image.mimeType,
      sizeBytes: image.data.byteLength,
      slideNumbers: image.slideNumbers,
      placements: image.placements,
    });
  }
  return stored;
}
