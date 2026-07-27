import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { v, type ObjectType } from "convex/values";
import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";
import { saveGenerationContinuationArgs } from "../chat/mutations_args";
import { saveGenerationContinuationHandler } from
  "../chat/mutations_generation_continuation_handlers";
import type { GenerationContinuationCheckpoint } from
  "../chat/generation_continuation_shared";
import { closeSupersededDriveBatchesHandler } from "./superseded_cleanup";
import { appendAttachmentsAndMarkResumingHandler } from
  "./resume_mutation_handlers";

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

const createBatchArgs = {
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
};

type CreateBatchArgs = ObjectType<typeof createBatchArgs>;

export async function createBatchHandler(ctx: MutationCtx, args: CreateBatchArgs) {
    const now = Date.now();
    const workflowResumeEventId = (args.paramsSnapshot as { workflowResumeEventId?: unknown })
      .workflowResumeEventId;
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
      workflowResumeEventId: typeof workflowResumeEventId === "string"
        ? workflowResumeEventId
        : undefined,
      participantSnapshot: args.participantSnapshot,
      createdAt: now,
      updatedAt: now,
    });
    await closeSupersededDriveBatchesHandler(ctx, {
      jobId: args.parentJobId,
      keepBatchId: batchId,
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
}

export const createBatch = internalMutation({
  args: createBatchArgs,
  handler: createBatchHandler,
});

export const createDurableBatchAndCheckpoint = internalMutation({
  args: {
    ...createBatchArgs,
    checkpoint: saveGenerationContinuationArgs.checkpoint,
  },
  handler: async (ctx, args) => {
    const { checkpoint, ...batchArgs } = args;
    const result = await createBatchHandler(ctx, batchArgs);
    await saveGenerationContinuationHandler(ctx, {
      chatId: args.chatId,
      messageId: args.parentMessageId,
      jobId: args.parentJobId,
      userId: args.userId,
      checkpoint: {
        ...checkpoint,
        deferredOwnership: { kind: "drive_picker", batchId: result.batchId },
        group: {
          ...checkpoint.group,
          drivePickerBatchId: result.batchId,
        },
      } as GenerationContinuationCheckpoint,
    });
    return result;
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
    const job = await ctx.db.get(batch.parentJobId);
    if (job) {
      await cancelExecutionForGenerationJob(ctx, {
        jobId: batch.parentJobId,
        requestedBy: args.userId,
        now,
      });
      await finalizeGenerationHandler(ctx, {
        messageId: batch.parentMessageId,
        jobId: batch.parentJobId,
        chatId: batch.chatId,
        content: "[Generation cancelled]",
        status: "cancelled",
        userId: args.userId,
        skipExecutionTerminalization: true,
      });
    }
    await ctx.db.patch(batch.parentMessageId, {
      drivePickerBatchId: undefined,
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
  handler: appendAttachmentsAndMarkResumingHandler,
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
