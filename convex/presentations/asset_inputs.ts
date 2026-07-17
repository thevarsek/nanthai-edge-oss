import type { ActionCtx } from "../_generated/server";
import type { PresentationProjectDoc } from "./types";

const MAX_MODEL_VISUAL_ASSETS = 8;
const MAX_MODEL_VISUAL_BYTES = 20 * 1024 * 1024;

export interface PresentationPromptAsset {
  storageId: string;
  altText: string;
  dataUrl?: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export async function loadPresentationPromptAssets(
  ctx: ActionCtx,
  project: PresentationProjectDoc,
): Promise<PresentationPromptAsset[]> {
  const storageIds = project.assetStorageIds ?? [];
  if (storageIds.length === 0) return [];
  const assets: PresentationPromptAsset[] = [];
  let totalBytes = 0;
  for (const [index, storageId] of storageIds.entries()) {
    if (assets.length >= MAX_MODEL_VISUAL_ASSETS) break;
    const blob = await ctx.storage.get(storageId);
    if (!blob || !blob.type.startsWith("image/") ||
        totalBytes + blob.size > MAX_MODEL_VISUAL_BYTES) {
      continue;
    }
    totalBytes += blob.size;
    assets.push({
      storageId: String(storageId),
      altText: `Reusable presentation asset ${index + 1}`,
      dataUrl: `data:${blob.type};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`,
    });
  }
  return assets;
}
