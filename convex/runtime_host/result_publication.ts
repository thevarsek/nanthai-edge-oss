import { persistArtifactCapture } from "../tools/artifact_persistence";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import { assertCurrentExecution } from "../execution/attempts";
import { ensureGeneratedFileRow } from "../chat/generated_file_registration";
import { prepareOperationHandler, completeOperationHandler } from "../execution/operations";
import { appendExecutionEvent } from "../execution/control_plane";

const authority = {
  deviceId: v.string(), credentialId: v.string(), credential: v.string(), presenceSessionId: v.string(),
  attemptId: v.id("executionAttempts"), fence: v.number(),
};
export const authorize = internalMutation({
  args: authority, returns: v.null(),
  handler: async (ctx, args) => {
    const host = await authenticateOnlineRuntimeHost(ctx, args);
    await assertCurrentExecution(ctx, { ...args, claimantId: host.claimantId });
    return null;
  },
});

export const publish = internalMutation({
  args: { ...authority, callId: v.string(), inputHash: v.string(), storageId: v.id("_storage"), filename: v.string(), mimeType: v.string(), sizeBytes: v.number(), content: v.string() },
  returns: v.object({ generatedFileId: v.id("generatedFiles"), storageId: v.id("_storage"), filename: v.string() }),
  handler: async (ctx, args) => {
    const host = await authenticateOnlineRuntimeHost(ctx, args);
    const { run, attempt } = await assertCurrentExecution(ctx, { ...args, claimantId: host.claimantId });
    const job = run.generationJobId ? await ctx.db.get(run.generationJobId) : null;
    if (!job || !run.chatId || job.userId !== host.device.userId || !["queued", "streaming"].includes(job.status)) throw new Error("RUNTIME_PUBLICATION_NOT_ACTIVE");
    const metadata = await ctx.storage.getMetadata(args.storageId);
    if (!metadata || metadata.size !== args.sizeBytes || args.sizeBytes > 512_000) throw new Error("RUNTIME_PUBLICATION_STORAGE_INVALID");
    const operationKey = `runtime-result:${args.inputHash}`;
    const decision = await prepareOperationHandler(ctx, {
      attemptId: attempt._id, fence: attempt.fence, jobId: job._id, operationKey,
      toolName: "nanthai_publish_result", toolCallId: args.callId,
      effect: "write", retry: "safe", authorizationSource: "explicit_user_turn", inputHash: args.inputHash,
    });
    if (decision.decision === "refuse") throw new Error(decision.reason);
    if (decision.decision === "replay") {
      const saved = JSON.parse(decision.resultJson) as { generatedFileId: Id<"generatedFiles">; storageId: typeof args.storageId; filename: string };
      if (saved.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      return saved;
    }
    const registered = await ensureGeneratedFileRow(ctx, {
      userId: job.userId, chatId: job.chatId, messageId: job.messageId,
      file: { storageId: args.storageId, filename: args.filename, mimeType: args.mimeType, sizeBytes: args.sizeBytes, toolName: "nanthai_publish_result" },
    });
    const message = await ctx.db.get(job.messageId);
    if (!message) throw new Error("RUNTIME_PUBLICATION_MESSAGE_MISSING");
    await ctx.db.patch(message._id, { generatedFileIds: [...new Set([...(message.generatedFileIds ?? []), registered.id])] });
    const result = { generatedFileId: registered.id, storageId: args.storageId, filename: args.filename };
    const capture = await persistArtifactCapture(ctx, {
      captureKey: operationKey, executionAttemptId: attempt._id, executionFence: attempt.fence,
      artifacts: [{
        userId: job.userId, chatId: job.chatId, jobId: job._id, messageId: job.messageId,
        sourceUserMessageId: job.runtimeSourceMessageId, runtimeKind: "chat_generation",
        visibilityScope: "branch", runtimeIsolationPolicy: "shared_readonly",
        toolCallId: args.callId, toolName: "nanthai_publish_result", round: 0,
        argumentsHash: args.inputHash, argumentsBytes: 0,
        resultRaw: JSON.stringify({ ...result, content: args.content }), resultStorageId: args.storageId,
        resultBytes: args.sizeBytes, status: "completed", privacyClassification: "normal", contextClass: "operational",
      }],
    });
    if (capture.stale) throw new Error("RUNTIME_PUBLICATION_FENCE_CLOSED");
    await completeOperationHandler(ctx, { attemptId: attempt._id, fence: attempt.fence, operationKey, resultJson: JSON.stringify(result) });
    await appendExecutionEvent(ctx, {
      attemptId: attempt._id, fence: attempt.fence, claimantId: host.claimantId,
      type: "artifact_created", summary: `Published ${args.filename}`, artifactIds: [String(registered.id)], eventId: operationKey,
    });
    return result;
  },
});
