// convex/drive_picker/actions.ts
// =============================================================================
// Chat-flow Google Drive Picker actions.
//
// Drive metadata fetch / blob download / cache-aware ingest live in
// `./ingest.ts` and are shared with the M24 Phase 6 Knowledge Base import
// flow (`convex/knowledge_base/actions.ts`). Keep the per-fileId attach +
// resume-generation logic here.
// =============================================================================

import { action, internalAction, type ActionCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";
import { getGoogleAccessToken } from "../tools/google/auth";
import {
  CachedAttachment,
  MAX_TOTAL_ATTACHMENT_BYTES,
  ingestDriveFile,
} from "./ingest";
import {
  resolveSnapshotRequireZdr,
  resolveWebSearchToolIntent,
} from "../subagents/shared";

type DrivePickerBatch = {
  userId: string;
  status: "awaiting_pick" | "resuming" | "completed" | "failed" | "cancelled";
  paramsSnapshot?: { workflowResumeEventId?: string };
};

export function shouldUseLegacySchedulerResume(
  orchestrationEngine: string | undefined,
  workflowResumeEventId?: string,
): boolean {
  return orchestrationEngine === "legacy_scheduler"
    || (!orchestrationEngine && !workflowResumeEventId);
}

async function scheduleWorkflowSignalRetry(
  ctx: ActionCtx,
  batchId: Id<"drivePickerBatches">,
  userId: string,
  attempt = 0,
): Promise<void> {
  const ownership = await ctx.runQuery(
    internal.drive_picker.ownership.getResumeOwnership,
    { batchId, userId },
  );
  if (shouldUseLegacySchedulerResume(
    ownership?.orchestrationEngine,
    ownership?.workflowResumeEventId,
  )) return;
  await ctx.scheduler.runAfter(
    500,
    internal.drive_picker.ownership.retryWorkflowResumeGate,
    { batchId, userId, attempt },
  );
}

async function signalWorkflowIfPresent(
  ctx: ActionCtx,
  batch: DrivePickerBatch,
  batchId: Id<"drivePickerBatches">,
): Promise<boolean> {
  const eventId = batch.paramsSnapshot?.workflowResumeEventId;
  if (!eventId) return false;
  return await ctx.runMutation(internal.drive_picker.ownership.signalWorkflowResume, {
    batchId,
    userId: batch.userId,
  });
}

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
      if (batch.status === "resuming") {
        const signaled = await signalWorkflowIfPresent(ctx, batch, args.batchId);
        if (!signaled) {
          await scheduleWorkflowSignalRetry(ctx, args.batchId, userId);
        }
      }
      return { success: true, status: batch.status };
    }

    const fileIds = Array.from(new Set(args.fileIds.map((id) => id.trim()).filter(Boolean)));
    if (fileIds.length === 0) {
      await ctx.runMutation(internal.drive_picker.mutations.cancelBatch, {
        batchId: args.batchId,
        userId,
      });
      await signalWorkflowIfPresent(ctx, batch, args.batchId);
      return { success: true, status: "cancelled" };
    }

    const { accessToken } = await getGoogleAccessToken(ctx, userId, "drive");
    const attachments: CachedAttachment[] = [];
    let totalBytes = 0;
    try {
      for (const fileId of fileIds) {
        const attachment = await ingestDriveFile(ctx, userId, accessToken, fileId);
        totalBytes += attachment.sizeBytes ?? 0;
        if (totalBytes <= MAX_TOTAL_ATTACHMENT_BYTES) {
          attachments.push(attachment);
          continue;
        }
        await ctx.runMutation(internal.drive_picker.mutations.cancelBatch, {
          batchId: args.batchId,
          userId,
        });
        await signalWorkflowIfPresent(ctx, batch, args.batchId);
        throw new ConvexError({ code: "VALIDATION", message: "Selected Drive files are too large to attach together." });
      }
    } catch (error) {
      const data = error instanceof ConvexError
        ? error.data as { code?: unknown }
        : null;
      if (data?.code === "DRIVE_FILE_TOO_LARGE") {
        await ctx.runMutation(internal.drive_picker.mutations.cancelBatch, {
          batchId: args.batchId,
          userId,
        });
        await signalWorkflowIfPresent(ctx, batch, args.batchId);
      }
      throw error;
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
    if (resume.terminal) {
      throw new ConvexError({
        code: "VALIDATION",
        message: "Generation is no longer available for Drive picker resume.",
      });
    }

    if (await signalWorkflowIfPresent(ctx, batch, args.batchId)) {
      return { success: true, status: "resuming", attachedCount: attachments.length };
    }

    // Production-drain compatibility is only valid when the persisted attempt
    // explicitly says it is scheduler-owned. A missing/stale Workflow event is
    // retried; it must never start a second generation engine.
    if (!shouldUseLegacySchedulerResume(resume.orchestrationEngine)) {
      await scheduleWorkflowSignalRetry(ctx, args.batchId, userId);
      return { success: true, status: "resuming", attachedCount: attachments.length };
    }

    const scheduledFunctionId = await ctx.scheduler.runAfter(0, internal.chat.actions_runtime.runGeneration, {
      chatId: resume.chatId,
      userMessageId: resume.userMessageId,
      assistantMessageIds: resume.assistantMessageIds,
      generationJobIds: resume.generationJobIds,
      participants: [resume.participant],
      userId: resume.userId,
      expandMultiModelGroups: false,
      webSearchEnabled: resolveWebSearchToolIntent(resume.paramsSnapshot ?? {}),
      requireZdrOverride: resolveSnapshotRequireZdr(resume.paramsSnapshot ?? {}),
      enabledIntegrations: resume.paramsSnapshot?.enabledIntegrations ?? [],
      turnSkillOverrides: resume.paramsSnapshot?.turnSkillOverrides,
      turnIntegrationOverrides: resume.paramsSnapshot?.turnIntegrationOverrides,
      subagentsEnabled: false,
      drivePickerBatchId: args.batchId,
      analytics: resume.paramsSnapshot?.analytics,
      analyticsSource: resume.paramsSnapshot?.analyticsSource,
    });

    await ctx.runMutation(internal.drive_picker.mutations.scheduleResume, {
      batchId: args.batchId,
      scheduledFunctionId,
    });

    return { success: true, status: "resuming", attachedCount: attachments.length };
  },
});

export const retryWorkflowResume = internalAction({
  args: {
    batchId: v.id("drivePickerBatches"),
    userId: v.string(),
    attempt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const batch = await ctx.runQuery(
      internal.drive_picker.mutations.getBatchForUser,
      { batchId: args.batchId, userId: args.userId },
    ) as DrivePickerBatch | null;
    if (!batch || batch.status !== "resuming") return false;
    if (await signalWorkflowIfPresent(ctx, batch, args.batchId)) return true;
    await ctx.runMutation(internal.drive_picker.ownership.retryWorkflowResumeGate, args);
    return false;
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
