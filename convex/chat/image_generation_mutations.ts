import { ConvexError, v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { GENERATED_MEDIA_REFERENCE_TRACKING_VERSION } from "../lib/generated_media_reference_tracking";
import { usageObject } from "../schema_validators";
import { finalizeGenerationHandler } from "./mutations_internal_handlers";

const generatedImage = v.object({
  url: v.string(),
  storageId: v.id("_storage"),
  mimeType: v.string(),
  sizeBytes: v.number(),
});

/** Publish the capability-adapted count before transport so every client renders the same pending state. */
export const setExpectedImageCount = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    expectedCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (
      !job ||
      job.userId !== args.userId ||
      job.chatId !== args.chatId ||
      job.messageId !== args.messageId ||
      (job.status !== "queued" && job.status !== "streaming")
    ) {
      return null;
    }
    await ctx.db.patch(args.messageId, {
      imageGenerationExpectedCount: Math.max(1, Math.round(args.expectedCount)),
    });
    return null;
  },
});

/** Atomically publish the message and its Knowledge Base media rows. */
export const publishGeneratedImages = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    modelId: v.string(),
    prompt: v.string(),
    images: v.array(generatedImage),
    requestedCount: v.number(),
    usage: v.optional(usageObject),
    triggerUserMessageId: v.optional(v.id("messages")),
    openrouterGenerationId: v.optional(v.string()),
  },
  returns: v.object({
    published: v.boolean(),
    cancelled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return { published: false, cancelled: false };
    if (
      job.userId !== args.userId ||
      job.chatId !== args.chatId ||
      job.messageId !== args.messageId
    ) {
      throw new ConvexError({
        code: "INTERNAL_ERROR",
        message: "Image generation publication did not match its job.",
      });
    }

    if (job.status === "cancelled") {
      await finalizeGenerationHandler(ctx, {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        jobId: args.jobId,
        content: "",
        status: "completed",
        triggerUserMessageId: args.triggerUserMessageId,
        openrouterGenerationId: args.openrouterGenerationId,
      });
      return { published: false, cancelled: true };
    }
    if (job.status !== "queued" && job.status !== "streaming") {
      return { published: false, cancelled: false };
    }

    for (const image of args.images) {
      await ctx.db.insert("generatedMedia", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        storageId: image.storageId,
        type: "image",
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        model: args.modelId,
        prompt: args.prompt,
        referenceTrackingVersion: GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
        createdAt: Date.now(),
      });
    }

    const imageUrls = args.images.map((image) => image.url);
    const imageMimeTypes = args.images.map((image) => image.mimeType);
    await finalizeGenerationHandler(ctx, {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      jobId: args.jobId,
      content: "",
      status: "completed",
      usage: args.usage,
      imageUrls,
      imageMimeTypes,
      imageGenerationResult: {
        requestedCount: args.requestedCount,
        generatedCount: args.images.length,
        failedCount: Math.max(0, args.requestedCount - args.images.length),
      },
      triggerUserMessageId: args.triggerUserMessageId,
      openrouterGenerationId: args.openrouterGenerationId,
    });
    return { published: true, cancelled: false };
  },
});
