import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  MAX_PRESENTATION_ASSETS,
  MAX_PRESENTATION_ASSET_BYTES,
  presentationError,
} from "./limits";

export interface PresentationAssetMetadata {
  storageId: Id<"_storage">;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  altText: string;
  kind: "attachment" | "pptx_extracted";
  sourceStorageId?: Id<"_storage">;
}

function requireImageAsset(asset: PresentationAssetMetadata): PresentationAssetMetadata {
  if (!asset.mimeType.toLowerCase().startsWith("image/")) {
    throw presentationError("VALIDATION", `${asset.filename} is not a supported image asset.`);
  }
  if (asset.sizeBytes <= 0 || asset.sizeBytes > MAX_PRESENTATION_ASSET_BYTES) {
    throw presentationError(
      "VALIDATION",
      `${asset.filename} exceeds the presentation asset size limit.`,
    );
  }
  return asset;
}

async function findOwnedAsset(
  ctx: MutationCtx,
  userId: string,
  storageId: Id<"_storage">,
): Promise<PresentationAssetMetadata> {
  const [presentationAsset, attachment, generatedFile, generatedMedia] = await Promise.all([
    ctx.db
      .query("presentationAssets")
      .withIndex("by_user_storage", (query) =>
        query.eq("userId", userId).eq("storageId", storageId)
      )
      .first(),
    ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (query) => query.eq("storageId", storageId))
      .first(),
    ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (query) => query.eq("storageId", storageId))
      .first(),
    ctx.db
      .query("generatedMedia")
      .withIndex("by_storageId", (query) => query.eq("storageId", storageId))
      .first(),
  ]);
  if (presentationAsset) {
    return requireImageAsset({
      storageId,
      filename: presentationAsset.filename,
      mimeType: presentationAsset.mimeType,
      sizeBytes: presentationAsset.sizeBytes,
      altText: presentationAsset.altText,
      kind: presentationAsset.kind,
      sourceStorageId: presentationAsset.sourceStorageId,
    });
  }
  if (attachment?.userId === userId) {
    return requireImageAsset({
      storageId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes ?? 0,
      altText: attachment.filename,
      kind: "attachment",
    });
  }
  if (generatedFile?.userId === userId) {
    return requireImageAsset({
      storageId,
      filename: generatedFile.filename,
      mimeType: generatedFile.mimeType,
      sizeBytes: generatedFile.sizeBytes ?? 0,
      altText: generatedFile.filename,
      kind: "attachment",
    });
  }
  if (generatedMedia?.userId === userId && generatedMedia.type === "image") {
    const extension = generatedMedia.mimeType.toLowerCase().split("/")[1] || "png";
    return requireImageAsset({
      storageId,
      filename: `generated-image.${extension === "jpeg" ? "jpg" : extension}`,
      mimeType: generatedMedia.mimeType,
      sizeBytes: generatedMedia.sizeBytes ?? 0,
      altText: generatedMedia.prompt?.trim() || "Generated image",
      kind: "attachment",
    });
  }
  throw presentationError("NOT_FOUND", "Presentation asset not found or unauthorized.");
}

export async function resolveProjectAssets(
  ctx: MutationCtx,
  userId: string,
  requestedStorageIds: Id<"_storage">[],
  sourceStorageId?: Id<"_storage">,
): Promise<PresentationAssetMetadata[]> {
  const sourceAssets = sourceStorageId
    ? await ctx.db
        .query("presentationAssets")
        .withIndex("by_user_source", (query) =>
          query.eq("userId", userId).eq("sourceStorageId", sourceStorageId)
        )
        .collect()
    : [];
  const storageIds = [...new Set([
    ...requestedStorageIds.map(String),
    ...sourceAssets.map((asset) => String(asset.storageId)),
  ])] as Array<Id<"_storage">>;
  if (storageIds.length > MAX_PRESENTATION_ASSETS) {
    throw presentationError(
      "VALIDATION",
      `Presentations support up to ${MAX_PRESENTATION_ASSETS} reusable assets.`,
    );
  }
  return await Promise.all(storageIds.map(async (storageId) =>
    await findOwnedAsset(ctx, userId, storageId)
  ));
}

export async function attachProjectAssets(
  ctx: MutationCtx,
  projectId: Id<"presentationProjects">,
  userId: string,
  assets: PresentationAssetMetadata[],
): Promise<void> {
  const existing = await ctx.db
    .query("presentationAssets")
    .withIndex("by_project", (query) => query.eq("projectId", projectId))
    .collect();
  const existingStorageIds = new Set(existing.map((asset) => String(asset.storageId)));
  const now = Date.now();
  await Promise.all(assets.map(async (asset) => {
    if (existingStorageIds.has(String(asset.storageId))) return;
    await ctx.db.insert("presentationAssets", {
      userId,
      projectId,
      sourceStorageId: asset.sourceStorageId,
      storageId: asset.storageId,
      filename: asset.filename,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      altText: asset.altText,
      kind: asset.kind,
      createdAt: now,
    });
  }));
}

export async function registerPptxReferenceAsset(
  ctx: MutationCtx,
  args: {
    userId: string;
    sourceStorageId: Id<"_storage">;
    storageId: Id<"_storage">;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    altText: string;
  },
): Promise<Id<"_storage">> {
  const [sourceAttachment, sourceGenerated] = await Promise.all([
    ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (query) => query.eq("storageId", args.sourceStorageId))
      .first(),
    ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (query) => query.eq("storageId", args.sourceStorageId))
      .first(),
  ]);
  if (sourceAttachment?.userId !== args.userId && sourceGenerated?.userId !== args.userId) {
    throw presentationError("NOT_FOUND", "Presentation source file not found or unauthorized.");
  }
  requireImageAsset({
    storageId: args.storageId,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    altText: args.altText,
    kind: "pptx_extracted",
    sourceStorageId: args.sourceStorageId,
  });
  const existing = await ctx.db
    .query("presentationAssets")
    .withIndex("by_user_source", (query) =>
      query.eq("userId", args.userId).eq("sourceStorageId", args.sourceStorageId)
    )
    .collect();
  const duplicate = existing.find((asset) =>
    asset.filename === args.filename && asset.mimeType === args.mimeType
  );
  if (duplicate) return duplicate.storageId;
  await ctx.db.insert("presentationAssets", {
    ...args,
    kind: "pptx_extracted",
    createdAt: Date.now(),
  });
  return args.storageId;
}
