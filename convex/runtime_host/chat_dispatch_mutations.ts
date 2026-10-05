import { evidenceCandidateValidator, type EvidenceCandidate } from "../chat/source_evidence";
import { appendExecutionEvent } from "../execution/control_plane";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { enqueueRuntimeHostCommand } from "./command_transport";
import { registerRuntimeTurnPacket } from "./turn_packets";
import {
  registerRuntimeAttachmentFetchHandles,
  type RuntimeAttachmentGrantInput,
} from "./attachment_fetch_handles";

export async function commitLocalGenerationDispatchHandler(
  ctx: MutationCtx,
  args: {
    jobId: Id<"generationJobs">;
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    userId: string;
    targetDeviceId: string;
    commandId: string;
    commandType: "start" | "resume";
    commandPayload: string;
    packetHash: string;
    packetStorageId: Id<"_storage">;
    packetByteLength: number;
    packetExpiresAt: number;
    attachmentGrants: RuntimeAttachmentGrantInput[];
    completionEventId: string;
    sourceMessageId: Id<"messages">;
    expectedFrontierMessageId?: Id<"messages">;
    contextReceipt?: string;
    evidenceSources?: EvidenceCandidate[];
    replaceBindingId?: Id<"runtimeConversationBindings">;
  },
) {
  const job = await ctx.db.get(args.jobId);
  if (
    !job
    || job.userId !== args.userId
    || job.executionRunId !== args.runId
    || job.executionAttemptId !== args.attemptId
    || job.executionFence !== args.fence
  ) throw new Error("LOCAL_GENERATION_DISPATCH_STALE");
  if (
    job.runtimeCompletionEventId
    && job.runtimeCompletionEventId !== args.completionEventId
  ) throw new Error("LOCAL_GENERATION_EVENT_CONFLICT");
  if (args.replaceBindingId) {
    const binding = await ctx.db.get(args.replaceBindingId);
    if (!binding || binding.userId !== args.userId || binding.chatId !== job.chatId) throw new Error("RUNTIME_BINDING_REPLACEMENT_INVALID");
    await ctx.db.patch(binding._id, { status: "released", releasedAt: Date.now(), updatedAt: Date.now(), releaseReason: "context_changed" });
    await appendExecutionEvent(ctx, {
      attemptId: args.attemptId, fence: args.fence, type: "model_activity",
      summary: "Runtime session rebuilt on the selected route because authorized context changed.",
      eventId: `${args.commandId}:context-rebuilt`,
    });
  }
  const turnPacketId = await registerRuntimeTurnPacket(ctx, {
    runId: args.runId,
    attemptId: args.attemptId,
    fence: args.fence,
    userId: args.userId,
    commandId: args.commandId,
    packetHash: args.packetHash,
    storageId: args.packetStorageId,
    byteLength: args.packetByteLength,
    expiresAt: args.packetExpiresAt,
  });
  await registerRuntimeAttachmentFetchHandles(ctx, {
    turnPacketId,
    grants: args.attachmentGrants,
  });
  const commandRecordId = await enqueueRuntimeHostCommand(ctx, {
    runId: args.runId,
    attemptId: args.attemptId,
    fence: args.fence,
    targetDeviceId: args.targetDeviceId,
    commandId: args.commandId,
    type: args.commandType,
    authorizationSource: job.sourceJobId ? "configured_automation" : "explicit_user_turn",
    initiatedBy: args.userId,
    payload: args.commandPayload,
    turnPacketId,
    expiresAt: args.packetExpiresAt,
  });
  await ctx.db.patch(job._id, {
    status: "streaming",
    startedAt: job.startedAt ?? Date.now(),
    runtimeCompletionEventId: args.completionEventId,
    runtimeExpectedFrontierMessageId: args.expectedFrontierMessageId,
    runtimeContextReceipt: args.contextReceipt,
    runtimeEvidenceSources: args.evidenceSources,
    runtimeTurnPacketId: turnPacketId,
    runtimeCommandRecordId: commandRecordId,
    runtimeSourceMessageId: args.sourceMessageId,
  });
  return { turnPacketId, commandRecordId };
}

export const commitLocalGenerationDispatch = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    userId: v.string(),
    targetDeviceId: v.string(),
    commandId: v.string(),
    commandType: v.union(v.literal("start"), v.literal("resume")),
    commandPayload: v.string(),
    packetHash: v.string(),
    packetStorageId: v.id("_storage"),
    packetByteLength: v.number(),
    packetExpiresAt: v.number(),
    attachmentGrants: v.array(v.object({
      sourceMessageId: v.id("messages"),
      handle: v.string(),
      storageId: v.id("_storage"),
      mimeType: v.string(),
      byteLength: v.number(),
      maxChunkBytes: v.number(),
      sha256: v.string(),
      expiresAt: v.number(),
    })),
    completionEventId: v.string(),
    sourceMessageId: v.id("messages"),
    expectedFrontierMessageId: v.optional(v.id("messages")),
    contextReceipt: v.optional(v.string()),
    evidenceSources: v.optional(v.array(evidenceCandidateValidator)),
    replaceBindingId: v.optional(v.id("runtimeConversationBindings")),
  },
  returns: v.object({
    turnPacketId: v.id("runtimeTurnPackets"),
    commandRecordId: v.id("runtimeCommands"),
  }),
  handler: commitLocalGenerationDispatchHandler,
});
