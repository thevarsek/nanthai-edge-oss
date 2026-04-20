import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { requireAuth, requirePro, getIsProUnlocked } from "../lib/auth";
import { filterParticipantToolOptions } from "../lib/tool_capability";
import { MODEL_IDS } from "../lib/model_constants";
import {
  cancelGenerationJobsForMessage,
  createAssistantMessagesAndJobs,
  mapParticipantsForGeneration,
  SendParticipantConfig,
} from "./mutation_send_helpers";

const DEFAULT_CHAT_MODEL = MODEL_IDS.appDefault;

export interface RetryMessageArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  participants?: SendParticipantConfig[];
  expandMultiModelGroups?: boolean;
  webSearchEnabled?: boolean;
  searchMode?: "normal" | "web";
  complexity?: number;
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
  videoConfig?: {
    resolution?: string;
    aspectRatio?: string;
    duration?: number;
    generateAudio?: boolean;
  };
  turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
}

export interface RetryMessageResult {
  assistantMessageIds: Id<"messages">[];
}

const EXTERNAL_INTEGRATION_TOOL_PREFIXES = [
  "gmail_",
  "drive_",
  "google_calendar_",
  "outlook_",
  "onedrive_",
  "ms_calendar_",
  "apple_calendar_",
  "notion_",
] as const;

function requiresExplicitRetryIntegrations(
  originalMsg: {
    enabledIntegrations?: string[];
    toolCalls?: Array<{ name?: unknown }>;
    toolResults?: Array<{ toolName?: unknown }>;
  },
): boolean {
  if (originalMsg.enabledIntegrations !== undefined) {
    return false;
  }

  const usedExternalTool = (toolName: unknown): boolean =>
    typeof toolName === "string"
    && EXTERNAL_INTEGRATION_TOOL_PREFIXES.some((prefix) => toolName.startsWith(prefix));

  return (originalMsg.toolCalls ?? []).some((toolCall) => usedExternalTool(toolCall.name))
    || (originalMsg.toolResults ?? []).some((toolResult) => usedExternalTool(toolResult.toolName));
}

export async function retryMessageHandler(
  ctx: MutationCtx,
  args: RetryMessageArgs,
): Promise<RetryMessageResult> {
  const { userId } = await requireAuth(ctx);
  const now = Date.now();

  const originalMsg = await ctx.db.get(args.messageId);
  if (!originalMsg || originalMsg.role !== "assistant") {
    throw new ConvexError({ code: "NOT_FOUND", message: "Message not found or not an assistant message" });
  }

  const chat = await ctx.db.get(originalMsg.chatId);
  if (!chat || chat.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found" });
  }

  const participants: SendParticipantConfig[] = args.participants ?? [
    {
      modelId: originalMsg.modelId ?? DEFAULT_CHAT_MODEL,
      personaId: originalMsg.participantId,
      personaName: originalMsg.participantName,
      personaEmoji: originalMsg.participantEmoji,
      personaAvatarImageUrl: originalMsg.participantAvatarImageUrl,
    },
  ];

  if (args.enabledIntegrations === undefined
      && requiresExplicitRetryIntegrations(originalMsg)) {
    throw new ConvexError({
      code: "RETRY_INTEGRATIONS_UNAVAILABLE" as const,
      message:
        "This older response used tools, but its integration settings were not saved. Send the prompt again to choose integrations explicitly.",
    });
  }

  const effectiveEnabledIntegrations =
    args.enabledIntegrations ?? originalMsg.enabledIntegrations ?? undefined;

  // Consolidate Pro checks: web search and persona usage are Pro features.
  // Check after fallback participants are built so we also catch retries of
  // messages that originally used a persona (when args.participants is nil).
  const hasPersona = participants.some((p) => p.personaId);
  const requestedSubagents = args.subagentsEnabled ?? originalMsg.subagentsEnabled ?? false;
  const wantsSubagents = requestedSubagents && participants.length === 1;
  const requiresPro = args.searchMode === "web" || hasPersona || wantsSubagents;
  const isPro = requiresPro ? await getIsProUnlocked(ctx, userId) : false;
  const effectiveSubagentsEnabled = wantsSubagents && isPro;
  if ((args.searchMode === "web" || hasPersona) && !isPro) {
    await requirePro(ctx, userId);
  }

  // Silently strip tool-dependent features when any participant model
  // lacks tool support ("always on" = "always on where supported").
  const toolFilter = await filterParticipantToolOptions(ctx, {
    enabledIntegrations: effectiveEnabledIntegrations,
    participants,
    requireToolUse: effectiveSubagentsEnabled,
  });
  const filteredIntegrations = toolFilter.enabledIntegrations;
  const filteredSubagents = toolFilter.strippedModelIds.length > 0
    ? false
    : effectiveSubagentsEnabled;

  await ctx.db.patch(args.messageId, { status: "cancelled" });
  await cancelGenerationJobsForMessage(ctx, args.messageId, now);

  const { assistantMessageIds, generationJobIds, streamingMessageIds } =
    await createAssistantMessagesAndJobs(ctx, {
      chatId: originalMsg.chatId,
      userId,
      participants,
      parentMessageIds: originalMsg.parentMessageIds,
      assistantCreatedAt: now,
      jobCreatedAt: now,
      enabledIntegrations: filteredIntegrations,
      subagentsEnabled: filteredSubagents,
      turnSkillOverrides: args.turnSkillOverrides,
      turnIntegrationOverrides: args.turnIntegrationOverrides,
    });

  await ctx.db.patch(chat._id, {
    updatedAt: now,
    activeBranchLeafId: assistantMessageIds[0],
  });

  const effectiveSearchMode = args.searchMode ?? undefined;
  const retryUserMessageId = originalMsg.parentMessageIds[0];
  if (!retryUserMessageId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Cannot retry an assistant message without its source user message",
    });
  }
  const retryUserMessage = retryUserMessageId
    ? await ctx.db.get(retryUserMessageId)
    : null;
  const retryQueryText =
    typeof retryUserMessage?.content === "string" ? retryUserMessage.content.trim() : "";

  if (retryUserMessageId && retryQueryText.length > 0) {
    await ctx.scheduler.runAfter(0, internal.memory.operations.primeMessageQueryEmbedding, {
      messageId: retryUserMessageId,
      userId,
      chatId: originalMsg.chatId,
      queryText: retryQueryText,
    });
    await ctx.scheduler.runAfter(0, internal.memory.operations.primeMessageMemoryContext, {
      messageId: retryUserMessageId,
      userId,
      chatId: originalMsg.chatId,
      queryText: retryQueryText,
    });
  }

  if (!effectiveSearchMode || effectiveSearchMode === "normal") {
    const forceWebSearch =
      effectiveSearchMode === "normal" ? true : (args.webSearchEnabled ?? false);

    await ctx.scheduler.runAfter(0, internal.chat.actions_runtime.runGeneration, {
      chatId: originalMsg.chatId,
      userMessageId: retryUserMessageId,
      assistantMessageIds,
      generationJobIds,
      participants: mapParticipantsForGeneration(
        participants,
        assistantMessageIds,
        generationJobIds,
        streamingMessageIds,
      ),
      userId,
      expandMultiModelGroups: args.expandMultiModelGroups ?? true,
      webSearchEnabled: forceWebSearch,
      enabledIntegrations: filteredIntegrations,
      subagentsEnabled: filteredSubagents,
      videoConfig: args.videoConfig,
      turnSkillOverrides: args.turnSkillOverrides,
      turnIntegrationOverrides: args.turnIntegrationOverrides,
      // Phase 1 TTFT: scheduler hop #1 measurement
      enqueuedAt: Date.now(),
    });
  } else if (effectiveSearchMode === "web") {
    const cachedSearchContextDoc = await ctx.db
      .query("searchContexts")
      .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
      .first();
    const cachedSearchContext = cachedSearchContextDoc?.payload ?? undefined;
    const mappedParticipants = mapParticipantsForGeneration(
      participants,
      assistantMessageIds,
      generationJobIds,
    );
    const complexity = Math.max(1, Math.min(3, Math.round(args.complexity ?? 1)));
    const queryText = retryQueryText;

    for (const participant of mappedParticipants) {
      const sessionId = await ctx.db.insert("searchSessions", {
        chatId: originalMsg.chatId,
        userId,
        assistantMessageId: participant.messageId,
        query: queryText,
        mode: "web",
        complexity,
        status: cachedSearchContext ? "synthesizing" : (complexity === 1 ? "searching" : "planning"),
        progress: cachedSearchContext ? 70 : 0,
        currentPhase: cachedSearchContext ? "synthesizing" : (complexity === 1 ? "searching" : "planning"),
        phaseOrder: 0,
        participantId: participant.personaId ?? undefined,
        startedAt: now,
      });

      await ctx.db.patch(participant.messageId, { searchSessionId: sessionId });

      await ctx.scheduler.runAfter(
        0,
        internal.search.actions.runWebSearch,
        {
          sessionId,
          assistantMessageId: participant.messageId,
          jobId: participant.jobId,
          chatId: originalMsg.chatId,
          userMessageId: retryUserMessageId,
          userId,
          query: queryText,
          complexity,
          expandMultiModelGroups: args.expandMultiModelGroups ?? true,
          modelId: participant.modelId,
          personaId: participant.personaId ?? undefined,
          systemPrompt: participant.systemPrompt ?? undefined,
          temperature: participant.temperature,
          maxTokens: participant.maxTokens,
          includeReasoning: participant.includeReasoning,
          reasoningEffort: participant.reasoningEffort ?? undefined,
          cachedSearchContext: cachedSearchContext ?? undefined,
          enabledIntegrations: filteredIntegrations,
          subagentsEnabled: filteredSubagents,
        },
      );
    }
  }

  return { assistantMessageIds };
}
