// convex/drive_picker/actions.ts
// =============================================================================
// Chat-flow Google Drive Picker actions.
//
// Drive metadata fetch / blob download / cache-aware ingest live in
// `./ingest.ts` and are shared with the M24 Phase 6 Knowledge Base import
// flow (`convex/knowledge_base/actions.ts`). Keep the per-fileId attach +
// resume-generation logic here.
// =============================================================================

import { action, internalAction } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { requireAuth } from "../lib/auth";
import { getGoogleAccessToken } from "../tools/google/auth";
import {
  CachedAttachment,
  MAX_TOTAL_ATTACHMENT_BYTES,
  ingestDriveFile,
} from "./ingest";

type DrivePickerBatch = {
  status: "awaiting_pick" | "resuming" | "completed" | "failed" | "cancelled";
};

export const attachPickedDriveFiles = action({
  args: {
    batchId: v.id("drivePickerBatches"),
    fileIds: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: true; status: string; attachedCount?: number }> => {
    const { userId } = await requireAuth(ctx);
    const batch = await ctx.runQuery(internal.drive_picker.mutations.getBatchForUser, {
      batchId: args.batchId,
      userId,
    }) as DrivePickerBatch | null;
    if (!batch) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Drive picker batch not found." });
    }
    if (batch.status !== "awaiting_pick") {
      return { success: true, status: batch.status };
    }

    const fileIds = Array.from(new Set(args.fileIds.map((id) => id.trim()).filter(Boolean)));
    if (fileIds.length === 0) {
      await ctx.runMutation(internal.drive_picker.mutations.cancelBatch, {
        batchId: args.batchId,
        userId,
      });
      return { success: true, status: "cancelled" };
    }

    const { accessToken } = await getGoogleAccessToken(ctx, userId, "drive");
    const attachments: CachedAttachment[] = [];
    let totalBytes = 0;
    for (const fileId of fileIds) {
      const attachment = await ingestDriveFile(ctx, userId, accessToken, fileId);
      totalBytes += attachment.sizeBytes ?? 0;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        await ctx.runMutation(internal.drive_picker.mutations.cancelBatch, {
          batchId: args.batchId,
          userId,
        });
        throw new ConvexError({ code: "VALIDATION", message: "Selected Drive files are too large to attach together." });
      }
      attachments.push(attachment);
    }

    // Persist Drive provenance with each attachment so KB listings and the
    // lazy refresh path can find these rows by `driveFileId` + `modifiedTime`.
    // NOTE: `CachedAttachment.fileId` must be renamed to `driveFileId` here —
    // the mutation validator does not accept a raw `fileId` field.
    const persisted = attachments.map((attachment, idx) => {
      const { fileId, ...rest } = attachment;
      return {
        ...rest,
        driveFileId: fileId || fileIds[idx],
      };
    });

    const resume = await ctx.runMutation(internal.drive_picker.mutations.appendAttachmentsAndMarkResuming, {
      batchId: args.batchId,
      userId,
      pickedFileIds: fileIds,
      attachments: persisted,
    });

    const scheduledFunctionId = await ctx.scheduler.runAfter(0, internal.chat.actions_runtime.runGeneration, {
      chatId: resume.chatId,
      userMessageId: resume.userMessageId,
      assistantMessageIds: resume.assistantMessageIds,
      generationJobIds: resume.generationJobIds,
      participants: [resume.participant],
      userId: resume.userId,
      expandMultiModelGroups: false,
      webSearchEnabled: resume.paramsSnapshot?.requestParams?.webSearchEnabled ?? false,
      enabledIntegrations: resume.paramsSnapshot?.enabledIntegrations ?? [],
      turnSkillOverrides: resume.paramsSnapshot?.turnSkillOverrides,
      turnIntegrationOverrides: resume.paramsSnapshot?.turnIntegrationOverrides,
      subagentsEnabled: false,
      drivePickerBatchId: args.batchId,
    });

    await ctx.runMutation(internal.drive_picker.mutations.scheduleResume, {
      batchId: args.batchId,
      scheduledFunctionId,
    });

    return { success: true, status: "resuming", attachedCount: attachments.length };
  },
});

export const completeAfterResume = internalAction({
  args: {
    batchId: v.id("drivePickerBatches"),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
  },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.drive_picker.mutations.completeBatch, args);
  },
});
