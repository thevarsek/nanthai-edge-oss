import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { assertCurrentFence } from "../execution/control_plane";
import { completeOperationHandler } from "../execution/operations";
import { GENERATED_MEDIA_REFERENCE_TRACKING_VERSION } from "../lib/generated_media_reference_tracking";
import { storageHasContentReferences } from "../knowledge_base/delete_helpers";

export const insertGeneratedMediaBatch = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    operationKey: v.string(),
    operationResultJson: v.string(),
    media: v.array(v.object({
      storageId: v.id("_storage"),
      type: v.union(v.literal("image"), v.literal("video")),
      mimeType: v.string(),
      sizeBytes: v.optional(v.number()),
      durationSeconds: v.optional(v.number()),
      model: v.optional(v.string()),
      prompt: v.optional(v.string()),
    })),
  },
  returns: v.array(v.id("generatedMedia")),
  handler: async (ctx, args) => {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
    const [job, message] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.messageId),
    ]);
    if (
      !job || !message || job.userId !== args.userId || message.userId !== args.userId ||
      job.chatId !== args.chatId || message.chatId !== args.chatId ||
      job.messageId !== args.messageId || !["queued", "streaming"].includes(job.status)
    ) {
      throw new Error("MEDIA_GENERATION_CONTEXT_STALE");
    }
    const now = Date.now();
    const ids = [];
    for (const item of args.media) {
      const existing = (await ctx.db
        .query("generatedMedia")
        .withIndex("by_storageId", (query) => query.eq("storageId", item.storageId))
        .collect())
        .find((candidate) =>
          candidate.userId === args.userId
          && candidate.chatId === args.chatId
          && candidate.messageId === args.messageId
          && candidate.type === item.type
        );
      if (existing) {
        ids.push(existing._id);
        continue;
      }
      ids.push(await ctx.db.insert("generatedMedia", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        storageId: item.storageId,
        type: item.type,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        durationSeconds: item.durationSeconds,
        model: item.model,
        prompt: item.prompt,
        referenceTrackingVersion: GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
        createdAt: now,
      }));
    }
    await completeOperationHandler(ctx, {
      attemptId: args.executionAttemptId,
      fence: args.executionFence,
      operationKey: args.operationKey,
      resultJson: args.operationResultJson,
    });
    return ids;
  },
});

export const insertGeneratedAudioFile = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    operationKey: v.string(),
    operationResultDataJson: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    toolName: v.union(v.literal("generate_music"), v.literal("generate_speech")),
  },
  returns: v.object({
    generatedFileId: v.id("generatedFiles"),
    resultJson: v.string(),
  }),
  handler: async (ctx, args) => {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
    const [job, message] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.messageId),
    ]);
    if (
      !job || !message || job.userId !== args.userId || message.userId !== args.userId ||
      job.chatId !== args.chatId || message.chatId !== args.chatId ||
      job.messageId !== args.messageId || !["queued", "streaming"].includes(job.status)
    ) {
      throw new Error("MEDIA_GENERATION_CONTEXT_STALE");
    }
    const existing = await ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    let generatedFileId: Id<"generatedFiles">;
    if (existing) {
      if (existing.userId !== args.userId || existing.messageId !== args.messageId) {
        throw new Error("MEDIA_GENERATION_STORAGE_CONFLICT");
      }
      generatedFileId = existing._id;
    } else {
      generatedFileId = await ctx.db.insert("generatedFiles", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        storageId: args.storageId,
        filename: args.filename,
        mimeType: args.mimeType,
        sizeBytes: args.sizeBytes,
        toolName: args.toolName,
        createdAt: Date.now(),
      });
    }
    const operationResultData = JSON.parse(args.operationResultDataJson) as unknown;
    if (!operationResultData || typeof operationResultData !== "object" || Array.isArray(operationResultData)) {
      throw new Error("MEDIA_GENERATION_RESULT_INVALID");
    }
    const resultJson = JSON.stringify({
      success: true,
      data: {
        ...operationResultData,
        generatedFileId,
      },
    });
    await completeOperationHandler(ctx, {
      attemptId: args.executionAttemptId,
      fence: args.executionFence,
      operationKey: args.operationKey,
      resultJson,
    });
    return { generatedFileId, resultJson };
  },
});

export const insertFetchedImageAttachment = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
  },
  returns: v.id("fileAttachments"),
  handler: async (ctx, args) => {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
    const [job, message] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.messageId),
    ]);
    if (
      !job || !message || job.userId !== args.userId || message.userId !== args.userId ||
      job.chatId !== args.chatId || message.chatId !== args.chatId ||
      job.messageId !== args.messageId || !["queued", "streaming"].includes(job.status)
    ) {
      throw new Error("FETCHED_IMAGE_CONTEXT_STALE");
    }
    const existing = await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (query) => query.eq("storageId", args.storageId))
      .first();
    if (existing) {
      if (existing.userId !== args.userId) throw new Error("FETCHED_IMAGE_STORAGE_CONFLICT");
      return existing._id;
    }
    return await ctx.db.insert("fileAttachments", {
      userId: args.userId,
      chatId: args.chatId,
      storageId: args.storageId,
      filename: args.filename,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      createdAt: Date.now(),
    });
  },
});

export const deleteUnreferencedMediaStorage = internalMutation({
  args: { storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const storageId of new Set(args.storageIds)) {
      if (await storageHasContentReferences(ctx, storageId)) continue;
      await ctx.storage.delete(storageId).catch(() => undefined);
    }
    return null;
  },
});
