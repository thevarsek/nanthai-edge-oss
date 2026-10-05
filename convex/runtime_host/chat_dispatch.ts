import { packetContextReceipt, readContextReceipt, reusableContext } from "./context_receipt";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import { maybeFinalizeGenerationGroup } from "../chat/actions_run_generation_group_finalize";
import { runGenerationParticipantArgs } from "../chat/actions_args";
import type { RunGenerationParticipantArgs } from "../chat/generation_continuation_shared";
import { classifyTerminalErrorCode } from "../chat/terminal_error";
import { normalizeGenerationError } from "../chat/generation_error";
import { prepareLocalParticipantTurn } from "./chat_dispatch_context";
import { buildProductionRuntimePacket } from "./production_packet";
import { RUNTIME_PROTOCOL_VERSION } from "./protocol_common";
import { runtimeModelSelection } from "./runtime_model_selection";
import { runtimeThreadName } from "./runtime_thread_name";
import { materializeSourceImages } from "./chat_dispatch_images";

const PACKET_CLAIM_WINDOW_MS = 24 * 60 * 60 * 1_000;
const localDispatchContextRef = makeFunctionReference<"query">(
  "runtime_host/chat_dispatch_queries:getLocalGenerationDispatchContext",
);
const commitLocalDispatchRef = makeFunctionReference<"mutation">(
  "runtime_host/chat_dispatch_mutations:commitLocalGenerationDispatch",
);

type LocalDispatchContext = {
  placement: "local";
  includeSourceEvidence?: boolean;
  job: Doc<"generationJobs">;
  run: Doc<"executionRuns">;
  attempt: Doc<"executionAttempts">;
  sourceMessage: Doc<"messages">;
  assistantMessage: Doc<"messages">;
  chat: Doc<"chats">;
  participant: Doc<"chatParticipants">;
  persona: Doc<"personas">;
  binding: Doc<"runtimeConversationBindings"> | null;
  personaConfig: NonNullable<Doc<"generationJobs">["effectivePersonaConfig"]>;
};

export const dispatchLocalGeneration = internalAction({
  args: {
    ...runGenerationParticipantArgs,
    runtimeCompletionEventId: v.string(),
  },
  returns: v.union(v.literal("enqueued"), v.literal("terminal")),
  handler: async (ctx, args): Promise<"enqueued" | "terminal"> => {
    const participantArgs = args as RunGenerationParticipantArgs & {
      runtimeCompletionEventId: string;
    };
    try {
      const rawContext = await ctx.runQuery(
        localDispatchContextRef,
        { jobId: args.participant.jobId, sourceMessageId: args.userMessageId, webSearchEnabled: args.webSearchEnabled },
      );
      if (!rawContext || rawContext.placement !== "local") {
        throw new Error("LOCAL_GENERATION_DISPATCH_NOT_SELECTED");
      }
      const dispatch = rawContext as LocalDispatchContext;
      if (
        dispatch.job.runtimeCompletionEventId === args.runtimeCompletionEventId
        && dispatch.job.runtimeTurnPacketId
        && dispatch.job.runtimeCommandRecordId
      ) return "enqueued";
      if (!args.participant.chatParticipantId || !args.participant.personaId) {
        throw new Error("LOCAL_GENERATION_PERSONA_REQUIRED");
      }
      const deviceId = dispatch.attempt.deviceId;
      if (!deviceId) throw new Error("LOCAL_GENERATION_DEVICE_REQUIRED");
      const preparedTurn = await prepareLocalParticipantTurn(ctx, participantArgs, {
        personaPrompt: dispatch.personaConfig.systemPrompt,
      });
      const now = Date.now();
      const packetExpiresAt = now + PACKET_CLAIM_WINDOW_MS;
      const sourceImages = await materializeSourceImages(
        ctx,
        (preparedTurn.runtimeSourceMessages ?? [dispatch.sourceMessage]) as Doc<"messages">[],
        packetExpiresAt,
        new Set(preparedTurn.providerMessages.flatMap((message) => Array.isArray(message.content)
          ? message.content.flatMap((part) => part.type === "image_url" && part.image_url ? [part.image_url.url] : []) : [])),
        dispatch.job.userId,
      );
      const commandId = `turn-${String(dispatch.job._id)}-${dispatch.attempt.fence}`;
      const packet = await buildProductionRuntimePacket({
        runId: String(dispatch.run._id),
        attemptId: String(dispatch.attempt._id),
        fence: dispatch.attempt.fence,
        chatId: String(dispatch.chat._id),
        sourceMessageId: String(dispatch.sourceMessage._id),
        sourceImages: sourceImages.packetParts,
        participantId: String(dispatch.participant._id),
        participantName: dispatch.personaConfig.displayName,
        personaId: String(dispatch.persona._id),
        personaPrompt: dispatch.personaConfig.systemPrompt,
        preparedTurn,
        includeSourceEvidence: dispatch.includeSourceEvidence,
        webSearchEnabled: args.webSearchEnabled,
        moderatorDirective: dispatch.assistantMessage.moderatorDirective,
        placement: {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          runId: String(dispatch.run._id),
          attemptId: String(dispatch.attempt._id),
          fence: dispatch.attempt.fence,
          placement: "local",
          executorKind: "local_runtime",
          orchestrationEngine: "runtime_adapter",
          adapter: {
            adapterId: dispatch.attempt.adapterId,
            adapterVersion: dispatch.attempt.adapterVersion ?? null,
          },
          selectedModel: runtimeModelSelection(dispatch.attempt),
          device: {
            deviceId,
            displayName: dispatch.attempt.runtimeLabel ?? deviceId,
          },
          workingDirectory: { mode: "discover_at_session_start" },
        },
        commandId,
        idempotencyKey: commandId,
        cancellationId: `cancel-${String(dispatch.job._id)}-${dispatch.attempt.fence}`,
      });
      const receipt = await packetContextReceipt(packet, { version: preparedTurn.context.policyVersion, requireZdr: participantArgs.requireZdrOverride === true, expandMultiModelGroups: participantArgs.expandMultiModelGroups });
      const previous = readContextReceipt(dispatch.binding?.contextReceipt);
      const canResume = Boolean(dispatch.binding?.lastOwnedNativeTurnId)
        && Boolean(preparedTurn.runtimeBranchMessageIds?.includes(String(dispatch.binding?.canonicalFrontierMessageId)))
        && reusableContext(previous, receipt);
      const commandType = canResume ? "resume" as const : "start" as const;
      const threadName = runtimeThreadName(
        dispatch.chat.title,
        String(dispatch.chat._id),
      );
      const commandPayload = canResume && dispatch.binding
        ? JSON.stringify({
            nativeSessionId: dispatch.binding.nativeSessionId,
            checkpointRef: null,
            expectedNativeTurnId: dispatch.binding.lastOwnedNativeTurnId,
            deliveredMessageIds: previous?.entries.map((entry) => entry.id) ?? [],
            threadName,
          })
        : JSON.stringify({ threadName });
      const packetJson = JSON.stringify(packet);
      const packetStorageId = await ctx.storage.store(
        new Blob([packetJson], { type: "application/json" }),
      );
      await ctx.runMutation(
        commitLocalDispatchRef,
        {
          jobId: dispatch.job._id,
          runId: dispatch.run._id,
          attemptId: dispatch.attempt._id,
          fence: dispatch.attempt.fence,
          userId: dispatch.job.userId,
          targetDeviceId: deviceId,
          commandId,
          commandType,
          commandPayload,
          packetHash: packet.command.packetHash,
          packetStorageId,
          packetByteLength: new TextEncoder().encode(packetJson).byteLength,
          packetExpiresAt,
          attachmentGrants: sourceImages.grants,
          completionEventId: args.runtimeCompletionEventId,
          sourceMessageId: args.userMessageId,
          expectedFrontierMessageId: canResume ? dispatch.binding?.canonicalFrontierMessageId : undefined,
          contextReceipt: JSON.stringify(receipt),
        evidenceSources: dispatch.includeSourceEvidence ? preparedTurn.evidenceSources : undefined,
          replaceBindingId: !canResume ? dispatch.binding?._id : undefined,
        },
      );
      return "enqueued";
    } catch (error) {
      const summary = normalizeGenerationError(error).message;
      await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
        messageId: args.participant.messageId,
        jobId: args.participant.jobId,
        chatId: args.chatId,
        content: `Error: ${summary}`,
        status: "failed",
        error: summary,
        userId: args.userId,
        terminalErrorCode: classifyTerminalErrorCode({ status: "failed", error: summary }),
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      });
      return "terminal";
    }
  },
});

export const finalizeLocalGenerationGroup = internalAction({
  args: runGenerationParticipantArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    await maybeFinalizeGenerationGroup(ctx, args as RunGenerationParticipantArgs);
    return null;
  },
});
