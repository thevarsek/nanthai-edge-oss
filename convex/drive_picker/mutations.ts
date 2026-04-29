import { internalMutation, internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v, ConvexError } from "convex/values";
import { insertFileAttachment } from "../lib/file_attachments";
import type { ParticipantConfig } from "../chat/actions_run_generation_types";

type ParticipantSnapshot = {
  participant?: ParticipantConfig;
};

const attachmentValidator = v.object({
  type: v.string(),
  url: v.string(),
  storageId: v.id("_storage"),
  name: v.string(),
  mimeType: v.string(),
  sizeBytes: v.optional(v.number()),
  // M24 Phase 6: chat-flow Drive picker now persists Drive provenance so
  // these attachments surface in KB listings as `source: "drive"` and benefit
  // from the same lazy `modifiedTime` refresh path as Settings KB imports.
  driveFileId: v.optional(v.string()),
  modifiedTime: v.optional(v.string()),
});

function toMessageAttachment(attachment: {
  type: string;
  url: string;
  storageId: Id<"_storage">;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}) {
  return {
    type: attachment.type,
    url: attachment.url,
    storageId: attachment.storageId,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
  };
}

export const createBatch = internalMutation({
  args: {
    parentMessageId: v.id("messages"),
    sourceUserMessageId: v.id("messages"),
    parentJobId: v.id("generationJobs"),
    chatId: v.id("chats"),
    userId: v.string(),
    toolCallId: v.string(),
    toolCallArguments: v.string(),
    toolRoundCalls: v.any(),
    toolRoundResults: v.any(),
    resumeConversationSeed: v.any(),
    paramsSnapshot: v.any(),
    participantSnapshot: v.any(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batchId = await ctx.db.insert("drivePickerBatches", {
      parentMessageId: args.parentMessageId,
      sourceUserMessageId: args.sourceUserMessageId,
      parentJobId: args.parentJobId,
      chatId: args.chatId,
      userId: args.userId,
      status: "awaiting_pick",
      toolCallId: args.toolCallId,
      toolCallArguments: args.toolCallArguments,
      toolRoundCalls: args.toolRoundCalls,
      toolRoundResults: args.toolRoundResults,
      resumeConversationSeed: args.resumeConversationSeed,
      paramsSnapshot: args.paramsSnapshot,
      participantSnapshot: args.participantSnapshot,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.parentMessageId, {
      content: "",
      status: "completed",
      drivePickerBatchId: batchId,
    });

    const job = await ctx.db.get(args.parentJobId);
    if (job?.streamingMessageId) {
      const streaming = await ctx.db.get(job.streamingMessageId);
      if (streaming) {
        await ctx.db.patch(streaming._id, {
          content: "",
          status: "completed",
          updatedAt: now,
        });
      }
    }

    return { batchId };
  },
});

export const getBatchForUser = internalQuery({
  args: {
    batchId: v.id("drivePickerBatches"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== args.userId) return null;
    return batch;
  },
});

export const cancelBatch = internalMutation({
  args: {
    batchId: v.id("drivePickerBatches"),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== args.userId) return { cancelled: false };
    if (batch.status !== "awaiting_pick") return { cancelled: false };
    const now = Date.now();
    await ctx.db.patch(batch._id, { status: "cancelled", updatedAt: now });
    await ctx.db.patch(batch.parentMessageId, {
      status: "cancelled",
      drivePickerBatchId: undefined,
    });
    const job = await ctx.db.get(batch.parentJobId);
    if (job?.streamingMessageId) {
      await ctx.db.delete(job.streamingMessageId);
    }
    await ctx.db.patch(batch.parentJobId, {
      status: "cancelled",
      completedAt: now,
      scheduledFunctionId: undefined,
    });
    return { cancelled: true };
  },
});

export const appendAttachmentsAndMarkResuming = internalMutation({
  args: {
    batchId: v.id("drivePickerBatches"),
    userId: v.string(),
    pickedFileIds: v.array(v.string()),
    attachments: v.array(attachmentValidator),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch || batch.userId !== args.userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Drive picker batch not found." });
    }
    if (batch.status !== "awaiting_pick") {
      throw new ConvexError({ code: "VALIDATION", message: "Drive picker batch is not waiting for file selection." });
    }

    const now = Date.now();
    const sourceMessage = await ctx.db.get(batch.sourceUserMessageId);
    if (!sourceMessage || sourceMessage.userId !== args.userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Source message not found." });
    }

    const participantSnapshot = batch.participantSnapshot as ParticipantSnapshot;
    if (!participantSnapshot.participant) {
      throw new ConvexError({ code: "INTERNAL_ERROR", message: "Drive picker resume participant snapshot is missing." });
    }

    const existingAttachments = sourceMessage.attachments ?? [];
    const existingStorageIds = new Set(existingAttachments.map((attachment) => String(attachment.storageId ?? "")));
    const newAttachments = args.attachments.filter((attachment) => !existingStorageIds.has(String(attachment.storageId)));
    await ctx.db.patch(sourceMessage._id, {
      attachments: [...existingAttachments, ...newAttachments.map(toMessageAttachment)],
    });

    for (const attachment of newAttachments) {
      await insertFileAttachment(ctx, {
        userId: args.userId,
        chatId: batch.chatId,
        messageId: sourceMessage._id,
        storageId: attachment.storageId,
        filename: attachment.name,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        driveFileId: attachment.driveFileId,
        lastRefreshedAt: attachment.driveFileId ? now : undefined,
        createdAt: now,
      });
    }

    let streamingMessageId = (await ctx.db.get(batch.parentJobId))?.streamingMessageId;
    if (!streamingMessageId) {
      streamingMessageId = await ctx.db.insert("streamingMessages", {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        content: "",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch(streamingMessageId, {
        content: "",
        reasoning: undefined,
        toolCalls: undefined,
        status: "pending",
        updatedAt: now,
      });
    }

    await ctx.db.patch(batch.parentMessageId, {
      content: "",
      reasoning: undefined,
      toolCalls: undefined,
      toolResults: undefined,
      status: "pending",
      drivePickerBatchId: batch._id,
    });
    await ctx.db.patch(batch.parentJobId, {
      status: "queued",
      streamingMessageId,
      error: undefined,
      completedAt: undefined,
      scheduledFunctionId: undefined,
    });
    await ctx.db.patch(batch._id, {
      status: "resuming",
      pickedFileIds: args.pickedFileIds,
      updatedAt: now,
    });

    return {
      chatId: batch.chatId,
      userMessageId: batch.sourceUserMessageId,
      assistantMessageIds: [batch.parentMessageId],
      generationJobIds: [batch.parentJobId],
      participant: {
        ...participantSnapshot.participant,
        streamingMessageId,
      },
      userId: batch.userId,
      paramsSnapshot: batch.paramsSnapshot,
    };
  },
});

export const completeBatch = internalMutation({
  args: {
    batchId: v.id("drivePickerBatches"),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return;
    await ctx.db.patch(batch._id, {
      status: args.status,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(batch.parentMessageId, {
      drivePickerBatchId: undefined,
    });
  },
});

export const scheduleResume = internalMutation({
  args: {
    batchId: v.id("drivePickerBatches"),
    scheduledFunctionId: v.id("_scheduled_functions"),
  },
  handler: async (ctx, args) => {
    const batch = await ctx.db.get(args.batchId);
    if (!batch) return;
    await ctx.db.patch(batch.parentJobId, {
      scheduledFunctionId: args.scheduledFunctionId,
    });
  },
});
