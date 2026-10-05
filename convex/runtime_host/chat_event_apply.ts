import { recordRuntimeInputEvent } from "./input_requests";
import type { MutationCtx } from "../_generated/server";
import {
  getStreamingMessageByMessageId,
} from "../chat/streaming_state";
import {
  updateMessageContentHandler,
  updateMessageReasoningHandler,
} from "../chat/mutations_internal_handlers";
import { appendExecutionEvent } from "../execution/control_plane";
import { acquireConversationBindingHandler, resolveActiveConversationBinding } from "./conversation_bindings";
import { projectConsequentialAdapterEvent } from "./event_projection";
import {
  recordRuntimePermissionRequested,
  recordRuntimePermissionResolved,
} from "./permission_ingestion";
import type { NonTerminalAdapterEvent } from "./protocol_adapter_events";
import type { WorkerToHostMessage } from "./protocol_process";
import {
  terminalizeRuntimeChatTurn,
  type RuntimeChatEventContext,
} from "./chat_terminal_ingestion";
import { runtimeThreadName } from "./runtime_thread_name";
import { applyRuntimeNativeAgentEvent } from "./native_agent_ingestion";
import { aggregateRuntimeUsage } from "./usage_aggregation";
import { recordNativeAgentUsage } from "./native_agent_usage";

export type RuntimeCredentialInput = {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
};

export async function applyRuntimeWorkerMessage(
  ctx: MutationCtx,
  credentials: RuntimeCredentialInput,
  context: RuntimeChatEventContext,
  message: WorkerToHostMessage,
): Promise<void> {
  switch (message.kind) {
    case "bridge_call": throw new Error("Bridge requests must use the authenticated result endpoint");
    case "worker_ready":
    case "probe_result":
    case "models_result":
      return;
    case "session_result":
      if (message.payload.nativeSessionId) {
        await bindConversation(ctx, credentials, context, message.payload.nativeSessionId, message.payload.replacementReason);
      }
      return;
    case "command_result":
      if (message.payload.status === "rejected") {
        await failRuntimeTurn(ctx, context, message.payload.summary, message.sequence);
      }
      return;
    case "protocol_error":
      if (!message.payload.recoverable) {
        await failRuntimeTurn(ctx, context, message.payload.message, message.sequence);
      }
      return;
    case "adapter_event":
      await applyAdapterEvent(ctx, credentials, context, message.payload.event);
      return;
    case "terminal_event":
      await terminalizeRuntimeChatTurn(ctx, context, message.payload.event);
  }
}

async function applyAdapterEvent(
  ctx: MutationCtx,
  credentials: RuntimeCredentialInput,
  context: RuntimeChatEventContext,
  event: NonTerminalAdapterEvent,
): Promise<void> {
  if (event.type === "session_started") {
    await bindConversation(ctx, credentials, context, event.nativeSessionId);
  } else if (event.type === "text_delta") {
    const streaming = await getStreamingMessageByMessageId(ctx, context.job.messageId);
    await updateMessageContentHandler(ctx, {
      messageId: context.job.messageId,
      streamingMessageId: context.job.streamingMessageId,
      executionAttemptId: context.attempt._id,
      executionFence: context.attempt.fence,
      content: `${streaming?.content ?? ""}${event.delta}`,
      status: "streaming",
    }, { allowExpiredLease: context.allowExpiredLease });
  } else if (event.type === "reasoning_delta") {
    const streaming = await getStreamingMessageByMessageId(ctx, context.job.messageId);
    await updateMessageReasoningHandler(ctx, {
      messageId: context.job.messageId,
      streamingMessageId: context.job.streamingMessageId,
      executionAttemptId: context.attempt._id,
      executionFence: context.attempt.fence,
      reasoning: `${streaming?.reasoning ?? ""}${event.delta}`,
    }, { allowExpiredLease: context.allowExpiredLease });
  } else if (event.type === "usage_reported") {
    if (event.nativeAgentThreadId) {
      await recordNativeAgentUsage(ctx, context, event);
    } else {
      await ctx.db.patch(context.job._id, {
        runtimeUsage: aggregateRuntimeUsage(context.job.runtimeUsage, event),
      });
    }
  } else if (event.type === "input_requested" || event.type === "input_resolved") {
    await recordRuntimeInputEvent(ctx, context, event);
  } else if (event.type === "permission_requested") {
    await recordRuntimePermissionRequested(ctx, context, event);
  } else if (event.type === "permission_resolved") {
    await recordRuntimePermissionResolved(ctx, context, event);
  } else if (
    event.type === "native_agent_started"
    || event.type === "native_agent_activity"
    || event.type === "native_agent_status"
  ) {
    await applyRuntimeNativeAgentEvent(ctx, context, event);
  }

  const projection = projectConsequentialAdapterEvent(event);
  if (projection) {
    await appendExecutionEvent(ctx, {
      attemptId: context.attempt._id,
      fence: context.attempt.fence,
      claimantId: context.host.claimantId,
      allowExpiredLease: context.allowExpiredLease,
      eventId: projection.eventId,
      type: projection.type,
      summary: projection.summary,
      phase: projection.phase,
      progress: projection.progress,
      artifactIds: projection.artifactIds,
      privacyClass: projection.privacyClass,
      adapterDetail: projection.adapterDetail,
      now: event.occurredAt,
    });
  }
}

async function bindConversation(
  ctx: MutationCtx,
  credentials: RuntimeCredentialInput,
  context: RuntimeChatEventContext,
  nativeSessionId: string,
  replacementReason?: string,
): Promise<void> {
  const participantId = context.attempt.chatParticipantId;
  if (!participantId) throw new Error("RUNTIME_PERSONA_REQUIRED");
  const participant = await ctx.db.get(participantId);
  const personaId = context.job.effectivePersonaConfig?.personaId ?? participant?.personaId;
  const persona = personaId ? await ctx.db.get(personaId) : null;
  const chat = context.run.chatId ? await ctx.db.get(context.run.chatId) : null;
  if (!participant || !persona || !chat) throw new Error("RUNTIME_PERSONA_REQUIRED");
  if (replacementReason) {
    const binding = await resolveActiveConversationBinding(ctx, {
      userId: context.job.userId, chatParticipantId: participantId,
      routeSnapshotHash: context.attempt.routeSnapshotHash!,
      deviceId: context.host.device.deviceId, adapterId: context.attempt.adapterId,
    });
    const payload = JSON.parse(context.command.payload ?? "{}") as { nativeSessionId?: string };
    if (binding && binding.nativeSessionId !== nativeSessionId) {
      if (context.command.type !== "resume" || binding.nativeSessionId !== payload.nativeSessionId) throw new Error("RUNTIME_BINDING_REPLACEMENT_INVALID");
      await ctx.db.patch(binding._id, { status: "released", releasedAt: Date.now(), updatedAt: Date.now(), releaseReason: replacementReason });
      await ctx.db.patch(context.job._id, { runtimeExpectedFrontierMessageId: undefined });
    }
    await appendExecutionEvent(ctx, {
      attemptId: context.attempt._id, fence: context.attempt.fence,
      claimantId: context.host.claimantId,
      allowExpiredLease: context.allowExpiredLease, type: "model_activity",
      summary: "Runtime session rebuilt from authorized NanthAI context because the native conversation changed.",
      eventId: `${context.command.commandId}:session-rebuilt`,
    });
  }
  await acquireConversationBindingHandler(ctx, {
    ...credentials,
    attemptId: context.attempt._id,
    fence: context.attempt.fence,
    nativeSessionId,
    threadName: runtimeThreadName(chat.title, String(chat._id)),
  }, context.allowExpiredLease ? {
    claimantId: context.host.claimantId, allowExpiredLease: true,
  } : undefined);
}

export async function failRuntimeTurn(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  summary: string,
  sequence: number,
): Promise<void> {
  await terminalizeRuntimeChatTurn(ctx, context, {
    protocolVersion: "nanthai.runtime.v1",
    eventId: `${context.command.commandId}:failure:${sequence}`,
    sequence,
    occurredAt: Date.now(),
    runId: String(context.run._id),
    attemptId: String(context.attempt._id),
    fence: context.attempt.fence,
    sessionId: String(context.attempt._id),
    type: "terminal",
    outcome: "failed",
    summary: summary.slice(0, 2_000),
    errorCode: "runtime_host_failed",
    checkpointRef: null,
  });
}
