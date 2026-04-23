import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { getIsProUnlocked, requireAuth, requirePro } from "../lib/auth";
import { MODEL_IDS } from "../lib/model_constants";
import { filterParticipantToolOptions } from "../lib/tool_capability";
import { hasGoogleIntegrations, isGoogleDataAllowedProvider } from "../models/google_data_providers";
import {
  cancelGenerationJobsForMessage,
  createAssistantMessagesAndJobs,
  mapParticipantsForGeneration,
  SendParticipantConfig,
} from "./mutation_send_helpers";
import {
  buildRetryContract,
  cloneRetryContract,
  RetryContract as RetryContractType,
  RetryParticipantSnapshot,
  RetryContract,
  RetrySearchMode,
} from "./retry_contract";

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

function legacyParticipantsFromMessage(
  originalMsg: {
    modelId?: string;
    participantId?: Id<"personas">;
    participantName?: string;
    participantEmoji?: string;
    participantAvatarImageUrl?: string;
  },
): SendParticipantConfig[] {
  return [
    {
      modelId: originalMsg.modelId ?? DEFAULT_CHAT_MODEL,
      personaId: originalMsg.participantId,
      personaName: originalMsg.participantName,
      personaEmoji: originalMsg.participantEmoji,
      personaAvatarImageUrl: originalMsg.participantAvatarImageUrl,
    },
  ];
}

function asStoredRetryContract(value: unknown): RetryContract | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const contract = value as RetryContract;
  if (!Array.isArray(contract.participants) || contract.participants.length === 0) {
    return undefined;
  }
  if (
    contract.searchMode !== "none"
    && contract.searchMode !== "normal"
    && contract.searchMode !== "web"
  ) {
    return undefined;
  }
  return cloneRetryContract(contract);
}

function mergeRetryParticipantOverride(
  baseParticipant: RetryParticipantSnapshot,
  overrideParticipant: SendParticipantConfig,
): RetryParticipantSnapshot {
  return {
    modelId: overrideParticipant.modelId,
    personaId: "personaId" in overrideParticipant
      ? (overrideParticipant.personaId ?? null)
      : (baseParticipant.personaId ?? null),
    personaName: "personaName" in overrideParticipant
      ? (overrideParticipant.personaName ?? null)
      : (baseParticipant.personaName ?? null),
    personaEmoji: "personaEmoji" in overrideParticipant
      ? (overrideParticipant.personaEmoji ?? null)
      : (baseParticipant.personaEmoji ?? null),
    personaAvatarImageUrl: "personaAvatarImageUrl" in overrideParticipant
      ? (overrideParticipant.personaAvatarImageUrl ?? null)
      : (baseParticipant.personaAvatarImageUrl ?? null),
    systemPrompt: "systemPrompt" in overrideParticipant
      ? (overrideParticipant.systemPrompt ?? null)
      : (baseParticipant.systemPrompt ?? null),
    temperature: "temperature" in overrideParticipant
      ? overrideParticipant.temperature
      : baseParticipant.temperature,
    maxTokens: "maxTokens" in overrideParticipant
      ? overrideParticipant.maxTokens
      : baseParticipant.maxTokens,
    includeReasoning: "includeReasoning" in overrideParticipant
      ? overrideParticipant.includeReasoning
      : baseParticipant.includeReasoning,
    reasoningEffort: "reasoningEffort" in overrideParticipant
      ? (overrideParticipant.reasoningEffort ?? null)
      : (baseParticipant.reasoningEffort ?? null),
  };
}

function mergeStoredRetryParticipants(
  contract: RetryContractType,
  overrides: SendParticipantConfig[] | undefined,
): RetryParticipantSnapshot[] {
  if (!overrides) {
    return contract.participants;
  }

  return overrides.map((participant, index) => {
    const baseParticipant = contract.participants[index]
      ?? contract.participants[0]
      ?? {
        modelId: participant.modelId,
      };
    return mergeRetryParticipantOverride(baseParticipant, participant);
  });
}

async function resolveLegacySearchConfig(
  ctx: MutationCtx,
  originalMsg: {
    searchSessionId?: Id<"searchSessions">;
  },
): Promise<{ searchMode: RetrySearchMode; searchComplexity?: number }> {
  if (!originalMsg.searchSessionId) {
    return { searchMode: "none" };
  }

  const session = await ctx.db.get(originalMsg.searchSessionId);
  if (!session || session.mode !== "web") {
    return { searchMode: "none" };
  }

  return {
    searchMode: "web",
    searchComplexity:
      typeof session.complexity === "number" ? session.complexity : undefined,
  };
}

async function assertExplicitRetryParticipantsCompatible(
  ctx: MutationCtx,
  args: {
    participants: SendParticipantConfig[];
    enabledIntegrations?: string[];
    subagentsEnabled?: boolean;
  },
): Promise<void> {
  const needsToolSupport =
    (args.enabledIntegrations?.length ?? 0) > 0 || args.subagentsEnabled === true;
  const needsGoogleCompatibility = hasGoogleIntegrations(args.enabledIntegrations);

  if (!needsToolSupport && !needsGoogleCompatibility) {
    return;
  }

  for (const participant of args.participants) {
    const model = await ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", participant.modelId))
      .first();

    if (needsToolSupport && model?.supportsTools !== true) {
      throw new ConvexError({
        code: "RETRY_TOOL_CAPABLE_MODEL_REQUIRED" as const,
        message:
          "Choose a model with Tool Use to keep integrations enabled for this retry.",
        modelId: participant.modelId,
      });
    }

    if (needsGoogleCompatibility) {
      if (model?.hasZdrEndpoint !== true || !isGoogleDataAllowedProvider(model?.provider)) {
        throw new ConvexError({
          code: "RETRY_GOOGLE_COMPATIBLE_MODEL_REQUIRED" as const,
          message:
            "This model isn't available with Google Workspace integrations.",
          modelId: participant.modelId,
        });
      }
    }
  }
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

  const storedRetryContract = asStoredRetryContract(originalMsg.retryContract);
  let effectiveRetryContract: RetryContract;

  if (storedRetryContract) {
    effectiveRetryContract = buildRetryContract({
      ...storedRetryContract,
      participants: mergeStoredRetryParticipants(
        storedRetryContract,
        args.participants,
      ),
    });

    if (args.participants) {
      await assertExplicitRetryParticipantsCompatible(ctx, {
        participants: effectiveRetryContract.participants,
        enabledIntegrations: storedRetryContract.enabledIntegrations,
        subagentsEnabled: storedRetryContract.subagentsEnabled,
      });
    }
  } else {
    if (args.enabledIntegrations === undefined
        && requiresExplicitRetryIntegrations(originalMsg)) {
      throw new ConvexError({
        code: "RETRY_INTEGRATIONS_UNAVAILABLE" as const,
        message:
          "This older response used tools, but its integration settings were not saved. Send the prompt again to choose integrations explicitly.",
      });
    }

    const legacySearch = await resolveLegacySearchConfig(ctx, originalMsg);
    const legacySearchMode =
      args.searchMode ?? (legacySearch.searchMode === "web" ? "web" : undefined);
    const legacyContractSearchMode: RetrySearchMode =
      legacySearchMode ?? "none";

    effectiveRetryContract = buildRetryContract({
      participants: args.participants ?? legacyParticipantsFromMessage(originalMsg),
      searchMode: legacyContractSearchMode,
      searchComplexity:
        legacyContractSearchMode === "web"
          ? (args.complexity ?? legacySearch.searchComplexity)
          : undefined,
      enabledIntegrations:
        args.enabledIntegrations ?? originalMsg.enabledIntegrations ?? undefined,
      subagentsEnabled:
        args.subagentsEnabled ?? originalMsg.subagentsEnabled ?? false,
      turnSkillOverrides: args.turnSkillOverrides,
      turnIntegrationOverrides: args.turnIntegrationOverrides,
      videoConfig: args.videoConfig,
    });

    const legacyToolFilter = await filterParticipantToolOptions(ctx, {
      enabledIntegrations: effectiveRetryContract.enabledIntegrations,
      participants: effectiveRetryContract.participants,
      requireToolUse: effectiveRetryContract.subagentsEnabled,
    });
    effectiveRetryContract = buildRetryContract({
      ...effectiveRetryContract,
      enabledIntegrations: legacyToolFilter.enabledIntegrations,
      subagentsEnabled: legacyToolFilter.strippedModelIds.length > 0
        ? false
        : effectiveRetryContract.subagentsEnabled,
    });

    await assertExplicitRetryParticipantsCompatible(ctx, {
      participants: effectiveRetryContract.participants,
      enabledIntegrations: effectiveRetryContract.enabledIntegrations,
      subagentsEnabled: effectiveRetryContract.subagentsEnabled,
    });
  }

  const participants = effectiveRetryContract.participants;
  const hasPersona = participants.some((p) => p.personaId);
  const requestedSubagents =
    effectiveRetryContract.subagentsEnabled === true && participants.length === 1;
  const requiresPro =
    effectiveRetryContract.searchMode === "web" || hasPersona || requestedSubagents;
  const isPro = requiresPro ? await getIsProUnlocked(ctx, userId) : false;
  const effectiveSubagentsEnabled = requestedSubagents && isPro;

  if ((effectiveRetryContract.searchMode === "web" || hasPersona) && !isPro) {
    await requirePro(ctx, userId);
  }

  await ctx.db.patch(args.messageId, {
    status: "cancelled",
    terminalErrorCode: "cancelled_by_retry",
  });
  await cancelGenerationJobsForMessage(
    ctx,
    args.messageId,
    now,
    "cancelled_by_retry",
  );

  effectiveRetryContract = buildRetryContract({
    ...effectiveRetryContract,
    subagentsEnabled: effectiveSubagentsEnabled,
  });

  const { assistantMessageIds, generationJobIds, streamingMessageIds } =
    await createAssistantMessagesAndJobs(ctx, {
      chatId: originalMsg.chatId,
      userId,
      participants,
      parentMessageIds: originalMsg.parentMessageIds,
      assistantCreatedAt: now,
      jobCreatedAt: now,
      enabledIntegrations: effectiveRetryContract.enabledIntegrations,
      subagentsEnabled: effectiveSubagentsEnabled,
      turnSkillOverrides: effectiveRetryContract.turnSkillOverrides,
      turnIntegrationOverrides: effectiveRetryContract.turnIntegrationOverrides,
      retryContract: effectiveRetryContract,
    });

  await ctx.db.patch(chat._id, {
    updatedAt: now,
    activeBranchLeafId: assistantMessageIds[0],
  });

  const effectiveSearchMode =
    effectiveRetryContract.searchMode === "none"
      ? undefined
      : effectiveRetryContract.searchMode;
  const retryUserMessageId = originalMsg.parentMessageIds[0];
  if (!retryUserMessageId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Cannot retry an assistant message without its source user message",
    });
  }

  const retryUserMessage = await ctx.db.get(retryUserMessageId);
  const retryQueryText =
    typeof retryUserMessage?.content === "string" ? retryUserMessage.content.trim() : "";

  if (retryQueryText.length > 0) {
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
      webSearchEnabled: effectiveSearchMode === "normal",
      enabledIntegrations: effectiveRetryContract.enabledIntegrations,
      subagentsEnabled: effectiveSubagentsEnabled,
      videoConfig: effectiveRetryContract.videoConfig,
      turnSkillOverrides: effectiveRetryContract.turnSkillOverrides,
      turnIntegrationOverrides: effectiveRetryContract.turnIntegrationOverrides,
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
    const complexity = Math.max(
      1,
      Math.min(3, Math.round(effectiveRetryContract.searchComplexity ?? 1)),
    );

    for (const participant of mappedParticipants) {
      const sessionId = await ctx.db.insert("searchSessions", {
        chatId: originalMsg.chatId,
        userId,
        assistantMessageId: participant.messageId,
        query: retryQueryText,
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
          query: retryQueryText,
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
          enabledIntegrations: effectiveRetryContract.enabledIntegrations,
          subagentsEnabled: effectiveSubagentsEnabled,
        },
      );
    }
  }

  return { assistantMessageIds };
}
