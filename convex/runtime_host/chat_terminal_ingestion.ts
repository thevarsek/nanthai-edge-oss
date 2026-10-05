import { stripSourceEvidence, validateSourceEvidence, type EvidenceCandidate } from "../chat/source_evidence";
import { getStreamingMessageByMessageId } from "../chat/streaming_state";
import { completeLocalActivation } from "./activation";
import { receiptWithAssistant } from "./context_receipt";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers";
import { releaseRuntimeSession } from "../execution/bindings";
import { terminalizeExecutionComponentsForRun } from "../execution/component_refs";
import { transitionRuntimeCommand } from "../execution/commands";
import { terminalizeExecution } from "../execution/control_plane";
import { signalRuntimeCompletionHandler } from "./runtime_workflow_events";
import type { TerminalAdapterEvent } from "./protocol_adapter_events";
import { closeRuntimePermissionsForAttempt } from "./permission_ingestion";

export type RuntimeChatEventContext = {
  host: {
    credential: Doc<"runtimeDeviceCredentials">;
    device: Doc<"runtimeDevices">;
    claimantId: string;
  };
  run: Doc<"executionRuns">;
  attempt: Doc<"executionAttempts">;
  job: Doc<"generationJobs">;
  command: Doc<"runtimeCommands">;
  // Set only after authenticating replay against the original command credential.
  allowExpiredLease?: boolean;
};

export async function terminalizeRuntimeChatTurn(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: TerminalAdapterEvent,
): Promise<void> {
  const now = Date.now();
  const cancelled = context.run.state === "cancelling"
    || context.job.status === "cancelled" || event.outcome === "cancelled";
  const messageStatus = cancelled
    ? "cancelled" as const
    : event.outcome === "completed"
      ? "completed" as const
      : "failed" as const;
  const executionOutcome = cancelled
    ? "cancelled" as const
    : event.outcome === "completed"
      ? "completed" as const
      : "failed" as const;
  const error = messageStatus === "failed" ? event.summary : undefined;

  if (context.command.status === "acknowledged") {
    await transitionRuntimeCommand(ctx, context.command, {
      status: messageStatus === "failed" ? "rejected" : "completed",
      claimantId: context.host.claimantId,
      rejectionReason: error,
      now,
    });
  }

  const streaming = await getStreamingMessageByMessageId(ctx, context.job.messageId);
  const persisted = await ctx.db.get(context.job.messageId);
  const rawContent = streaming?.content ?? persisted?.content ?? "";
  const sourceCitations = validateSourceEvidence(rawContent, (context.job.runtimeEvidenceSources ?? []) as EvidenceCandidate[]);
  const content = stripSourceEvidence(rawContent);
  if (streaming && content !== rawContent) await ctx.db.patch(streaming._id, { content });
  const usage = runtimeUsageArgs(context.job.runtimeUsage);
  await finalizeGenerationHandler(ctx, {
    messageId: context.job.messageId,
    jobId: context.job._id,
    chatId: context.job.chatId,
    content,
    sourceCitations,
    status: messageStatus,
    error,
    usage: usage?.usage,
    usageModelId: usage?.modelId,
    usageProvider: usage?.provider,
    usageSource: usage ? "runtime_generation" : undefined,
    usageCostAttribution: usage?.costAttribution,
    usageRuntimeDeviceId: context.attempt.deviceId,
    usageRuntimeAdapterId: context.attempt.adapterId,
    preventUsageCostEstimate: true,
    userId: context.job.userId,
    triggerUserMessageId: context.job.runtimeSourceMessageId,
    executionAttemptId: context.attempt._id,
    executionFence: context.attempt.fence,
    skipExecutionTerminalization: true,
  });

  await advanceConversationFrontier(ctx, context, event, now);
  if (messageStatus === "completed") await completeLocalActivation(ctx, context.job.userId);
  await closeRuntimePermissionsForAttempt(
    ctx,
    context.attempt._id,
    `runtime_${executionOutcome}`,
    now,
  );
  const bindings = await ctx.db.query("runtimeSessionBindings")
    .withIndex("by_attempt_status", (query) =>
      query.eq("attemptId", context.attempt._id).eq("status", "active"),
    )
    .collect();
  for (const binding of bindings) {
    await releaseRuntimeSession(ctx, {
      bindingId: binding._id,
      attemptId: context.attempt._id,
      fence: context.attempt.fence,
      status: cancelled ? "revoked" : "released",
      allowExpiredLease: context.allowExpiredLease,
      reason: `runtime_${executionOutcome}`,
      now,
    });
  }
  await terminalizeExecutionComponentsForRun(ctx, {
    runId: context.run._id,
    status: executionOutcome === "completed"
      ? "completed"
      : executionOutcome === "cancelled" ? "cancelled" : "failed",
    now,
  });
  await terminalizeExecution(ctx, {
    attemptId: context.attempt._id,
    fence: context.attempt.fence,
    claimantId: context.host.claimantId,
    outcome: executionOutcome,
    summary: event.summary,
    allowWaiting: true,
    allowExpiredLease: context.allowExpiredLease,
    now,
  });
  if (context.job.runtimeCompletionEventId) {
    await signalRuntimeCompletionHandler(ctx, {
      eventId: context.job.runtimeCompletionEventId,
      value: {
        status: messageStatus,
        commandId: context.command.commandId,
      },
    });
  }
  await ctx.db.patch(context.host.credential._id, { lastUsedAt: now });
}

export async function advanceConversationFrontier(
  ctx: MutationCtx,
  context: RuntimeChatEventContext,
  event: TerminalAdapterEvent,
  now: number,
): Promise<void> {
  const participantId = context.attempt.chatParticipantId;
  const routeHash = context.attempt.routeSnapshotHash;
  if (!participantId || !routeHash) return;
  const binding = await ctx.db.query("runtimeConversationBindings")
    .withIndex("by_participant_route_status", (query) =>
      query.eq("chatParticipantId", participantId)
        .eq("routeSnapshotHash", routeHash)
        .eq("status", "active"),
    )
    .unique();
  if (!binding) return;
  if (binding.deviceId !== context.host.device.deviceId) throw new Error("RUNTIME_CONVERSATION_FRONTIER_CONFLICT");
  if (binding.canonicalFrontierMessageId !== context.job.runtimeExpectedFrontierMessageId) {
    // Concurrent turns may finish out of order. Their owned results still commit;
    // discard the ambiguous native cache and rebuild from canonical history next time.
    await ctx.db.patch(binding._id, { status: "released", releasedAt: now, updatedAt: now, releaseReason: "concurrent_frontier_changed" });
    return;
  }
  if (event.outcome !== "completed" || context.job.status === "cancelled" || !event.nativeTurnId) {
    // Partial/unknown native history is not a delivered canonical frontier.
    // Retain it as evidence; the next turn starts a fresh selected-route thread.
    await ctx.db.patch(binding._id, {
      status: "released", releasedAt: now, updatedAt: now,
      releaseReason: event.nativeTurnId ? `turn_${event.outcome}` : "native_turn_unreported",
    });
    return;
  }
  const message = await ctx.db.get(context.job.messageId);
  await ctx.db.patch(binding._id, {
    contextReceipt: await receiptWithAssistant(context.job.runtimeContextReceipt, String(context.job.messageId), message?.content ?? ""),
    canonicalFrontierMessageId: context.job.messageId,
    lastOwnedNativeTurnId: event.nativeTurnId,
    lastSyncAt: now,
    updatedAt: now,
  });
}

export function runtimeUsageArgs(usage: Doc<"generationJobs">["runtimeUsage"]) {
  if (!usage) return undefined;
  const promptTokens = usage.inputTokens ?? 0;
  const completionTokens = usage.outputTokens ?? 0;
  const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;
  const pricedInUsd = usage.costSource !== "unpriced"
    && usage.costCurrency === "USD"
    && usage.costAmount !== undefined;
  const rawModelId = usage.actualModelId;
  const modelId = rawModelId && usage.actualProvider && !rawModelId.includes("/")
    ? `${usage.actualProvider}/${rawModelId}`
    : rawModelId;
  return {
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      ...(pricedInUsd ? { cost: usage.costAmount } : {}),
      ...(usage.cachedInputTokens === undefined
        ? {}
        : { cachedTokens: usage.cachedInputTokens }),
      ...(usage.reasoningTokens === undefined
        ? {}
        : { reasoningTokens: usage.reasoningTokens }),
    },
    modelId,
    provider: usage.actualProvider,
    costAttribution: usage.costSource,
  };
}
