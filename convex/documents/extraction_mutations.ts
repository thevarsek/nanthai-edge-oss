import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  documentExtractionMethod,
  documentExtractionStatus,
} from "../schema_validators";

type ClaimVersionExtractionArgs = {
  versionId: Id<"documentVersions">;
  userId: string;
  leaseOwner: string;
  now: number;
  leaseExpiresAt: number;
  allowReadyReclaim?: boolean;
};

type ClaimVersionExtractionResult =
  | { state: "claimed" }
  | { state: "ready" }
  | { state: "busy"; leaseExpiresAt: number };

export const claimVersionExtraction = internalMutation({
  args: {
    versionId: v.id("documentVersions"),
    userId: v.string(),
    leaseOwner: v.string(),
    now: v.number(),
    leaseExpiresAt: v.number(),
    allowReadyReclaim: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({ state: v.literal("claimed") }),
    v.object({ state: v.literal("ready") }),
    v.object({
      state: v.literal("busy"),
      leaseExpiresAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => claimVersionExtractionHandler(ctx, args),
});

export async function claimVersionExtractionHandler(
  ctx: MutationCtx,
  args: ClaimVersionExtractionArgs,
): Promise<ClaimVersionExtractionResult> {
  const version = await ctx.db.get(args.versionId);
  if (!version || version.userId !== args.userId) {
    throw new ConvexError({
      code: "NOT_FOUND" as const,
      message: "Document version not found.",
    });
  }

  if (
    version.extractionStatus === "ready"
    && version.extractionTextStorageId
    && args.allowReadyReclaim !== true
  ) {
    return { state: "ready" };
  }

  const leaseExpiresAt = version.extractionLeaseExpiresAt;
  const activeLease = version.extractionStatus === "extracting"
    && typeof leaseExpiresAt === "number"
    && leaseExpiresAt > args.now;
  if (activeLease) {
    return { state: "busy", leaseExpiresAt };
  }

  await ctx.db.patch(args.versionId, {
    extractionStatus: "extracting",
    extractionError: undefined,
    extractionLeaseOwner: args.leaseOwner,
    extractionLeaseExpiresAt: Math.max(args.leaseExpiresAt, args.now + 1),
  });
  return { state: "claimed" };
}

export const updateVersionExtraction = internalMutation({
  args: {
    versionId: v.id("documentVersions"),
    leaseOwner: v.optional(v.string()),
    status: documentExtractionStatus,
    extractionMethod: v.optional(documentExtractionMethod),
    extractionTextStorageId: v.optional(v.id("_storage")),
    extractionMarkdownStorageId: v.optional(v.id("_storage")),
    extractionByteLength: v.optional(v.number()),
    extractionError: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    wordCount: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => updateVersionExtractionHandler(ctx, args),
});

type UpdateVersionExtractionArgs = {
  versionId: Id<"documentVersions">;
  leaseOwner?: string;
  status: "pending" | "extracting" | "ready" | "error" | "unsupported";
  extractionMethod?: "pypdf" | "mistral_ocr";
  extractionTextStorageId?: Id<"_storage">;
  extractionMarkdownStorageId?: Id<"_storage">;
  extractionByteLength?: number;
  extractionError?: string;
  pageCount?: number;
  wordCount?: number;
};

export async function updateVersionExtractionHandler(
  ctx: MutationCtx,
  args: UpdateVersionExtractionArgs,
): Promise<boolean> {
  const version = await ctx.db.get(args.versionId);
  if (!version) return false;
  if (args.leaseOwner && version.extractionLeaseOwner !== args.leaseOwner) {
    return false;
  }

  const clearLease = args.status !== "extracting";
  await ctx.db.patch(args.versionId, {
    extractionStatus: args.status,
    extractionMethod: args.extractionMethod,
    extractionTextStorageId: args.extractionTextStorageId,
    extractionMarkdownStorageId: args.extractionMarkdownStorageId,
    extractionByteLength: args.extractionByteLength,
    extractionError: args.extractionError,
    pageCount: args.pageCount,
    wordCount: args.wordCount,
    ...(clearLease
      ? {
          extractionLeaseOwner: undefined,
          extractionLeaseExpiresAt: undefined,
        }
      : {}),
  });

  const document = await ctx.db.get(version.documentId);
  if (!document?.currentVersionId || document.currentVersionId === args.versionId) {
    await ctx.db.patch(version.documentId, {
      status: args.status === "error" || args.status === "unsupported" ? "error" : "ready",
      lastExtractedAt: args.status === "ready" ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
  }
  return true;
}
