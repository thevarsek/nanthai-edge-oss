import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { ParticipantConfig } from "../chat/actions_run_generation_types";
import { insertFileAttachment } from "../lib/file_attachments";

type Attachment = {
  type: string;
  url: string;
  storageId: Id<"_storage">;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  driveFileId?: string;
  modifiedTime?: string;
};

export function resolveDriveResumeEngine(
  orchestrationEngine: "legacy_scheduler" | "convex_workflow"
    | "convex_workpool" | "runtime_adapter" | undefined,
  workflowResumeEventId: string | undefined,
) {
  return orchestrationEngine
    ?? (workflowResumeEventId ? "convex_workflow" : "legacy_scheduler");
}

export async function appendAttachmentsAndMarkResumingHandler(
  ctx: MutationCtx,
  args: {
    batchId: Id<"drivePickerBatches">;
    userId: string;
    pickedFileIds: string[];
    attachments: Attachment[];
  },
) {
  const batch = await ctx.db.get(args.batchId);
  if (!batch || batch.userId !== args.userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Drive picker batch not found." });
  }
  if (batch.status !== "awaiting_pick") {
    throw new ConvexError({ code: "VALIDATION", message: "Drive picker batch is not waiting for file selection." });
  }
  const job = await ctx.db.get(batch.parentJobId);
  if (!job || ["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
    await ctx.db.patch(batch._id, {
      status: job?.status === "cancelled" ? "cancelled" : "failed",
      updatedAt: Date.now(),
    });
    await ctx.db.patch(batch.parentMessageId, { drivePickerBatchId: undefined });
    return { terminal: true as const };
  }
  const now = Date.now();
  const sourceMessage = await ctx.db.get(batch.sourceUserMessageId);
  if (!sourceMessage || sourceMessage.userId !== args.userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Source message not found." });
  }
  const participant = (batch.participantSnapshot as { participant?: ParticipantConfig })
    .participant;
  if (!participant) {
    throw new ConvexError({
      code: "INTERNAL_ERROR",
      message: "Drive picker resume participant snapshot is missing.",
    });
  }
  const existingAttachments = sourceMessage.attachments ?? [];
  const existingStorageIds = new Set(
    existingAttachments.map((attachment) => String(attachment.storageId ?? "")),
  );
  const newAttachments = args.attachments.filter((attachment) =>
    !existingStorageIds.has(String(attachment.storageId))
  );
  await ctx.db.patch(sourceMessage._id, {
    attachments: [...existingAttachments, ...newAttachments.map((attachment) => ({
      type: attachment.type,
      url: attachment.url,
      storageId: attachment.storageId,
      name: attachment.name,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    }))],
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
  let streamingMessageId = job.streamingMessageId;
  if (!streamingMessageId) {
    streamingMessageId = await ctx.db.insert("streamingMessages", {
      userId: args.userId,
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
  const executionAttempt = job.executionAttemptId
    ? await ctx.db.get(job.executionAttemptId)
    : null;
  const workflowResumeEventId = (batch.paramsSnapshot as {
    workflowResumeEventId?: string;
  } | undefined)?.workflowResumeEventId;
  const orchestrationEngine = resolveDriveResumeEngine(
    executionAttempt?.orchestrationEngine,
    workflowResumeEventId,
  );
  if (orchestrationEngine !== "legacy_scheduler") {
    await ctx.scheduler.runAfter(
      0,
      internal.drive_picker.ownership.retryWorkflowResumeGate,
      { batchId: batch._id, userId: batch.userId, attempt: 0 },
    );
  }
  return {
    terminal: false as const,
    chatId: batch.chatId,
    userMessageId: batch.sourceUserMessageId,
    assistantMessageIds: [batch.parentMessageId],
    generationJobIds: [batch.parentJobId],
    participant: { ...participant, streamingMessageId },
    userId: batch.userId,
    paramsSnapshot: batch.paramsSnapshot,
    orchestrationEngine,
  };
}
