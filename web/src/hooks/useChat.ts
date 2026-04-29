// hooks/useChat.ts
// Subscribes to all data needed to render a single chat.
// Mirrors iOS ChatViewModel's 8 concurrent subscriptions.

import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Participant {
  id?: string;
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  systemPrompt?: string | null;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string | null;
}

export interface RetryContract {
  participants: Participant[];
  searchMode: "none" | "normal" | "web";
  searchComplexity?: number;
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
  turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  videoConfig?: {
    duration?: number;
    aspectRatio?: string;
    resolution?: string;
    generateAudio?: boolean;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
  isError?: boolean;
}

export type MessageStatus =
  | "pending"
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export interface Message {
  _id: Id<"messages">;
  _creationTime: number;
  chatId: Id<"chats">;
  role: "user" | "assistant" | "system";
  content: string;
  status: MessageStatus;
  modelId?: string;
  participantId?: string;
  participantName?: string;
  participantAvatarImageUrl?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  generatedFileIds?: Id<"generatedFiles">[];
  generatedChartIds?: Id<"generatedCharts">[];
  parentMessageIds?: Id<"messages">[];
  multiModelGroupId?: string;
  isMultiModelResponse?: boolean;
  subagentBatchId?: Id<"subagentBatches">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
  moderatorDirective?: string;
  searchSessionId?: Id<"searchSessions">;
  loadedSkillIds?: Id<"skills">[];
  usedIntegrationIds?: string[];
  imageUrls?: string[];
  videoUrls?: string[];
  attachments?: Array<{
    type: string;
    url?: string;
    storageId?: Id<"_storage">;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
    driveFileId?: string;
    lastRefreshedAt?: number;
  }>;
  audioStorageId?: Id<"_storage">;
  audioDurationMs?: number;
  audioGenerating?: boolean;
  citations?: Array<{ url: string; title: string }>;
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
  retryContract?: RetryContract;
  openrouterGenerationId?: string;
  terminalErrorCode?: "stream_timeout" | "provider_error" | "cancelled_by_retry" | "cancelled_by_user" | "unknown_error";
  createdAt: number;
}

export interface StreamingMessage {
  messageId: Id<"messages">;
  content: string;
  reasoning?: string;
  status: MessageStatus;
  toolCalls?: ToolCall[];
}

interface MergeCache {
  previousMessages: Message[];
  pendingFallbackMessages: Map<Id<"messages">, Message>;
}

const mergeCacheByChatId = new Map<string, MergeCache>();

function getMergeCache(chatId: Id<"chats"> | null | undefined): MergeCache {
  const key = (chatId ?? "__none__") as string;
  const existing = mergeCacheByChatId.get(key);
  if (existing) return existing;
  const created: MergeCache = {
    previousMessages: [],
    pendingFallbackMessages: new Map<Id<"messages">, Message>(),
  };
  mergeCacheByChatId.set(key, created);
  return created;
}

function mergeMessageWithFallback(previous: Message, current: Message): Message {
  return {
    ...current,
    content: previous.content,
    status: previous.status,
    reasoning: previous.reasoning,
    toolCalls: previous.toolCalls,
  };
}

function shouldReleasePendingStreamingFallback(
  fallback: Message,
  previous: Message,
  current: Message,
  base: Message,
): boolean {
  const overlayStillTerminal = previous.status === fallback.status;
  const currentAdvancedPastFallbackStatus = current.status !== fallback.status;
  const currentIncludesAtLeastFallbackContent = current.content.length >= fallback.content.length;
  const currentMatchesBase = current === base;
  // Server-authoritative terminal status always releases the fallback,
  // even if content shrank (e.g. trailing whitespace trim on finalize).
  const currentReachedTerminal =
    current.status === "completed" ||
    current.status === "failed" ||
    current.status === "cancelled";
  return (
    !overlayStillTerminal ||
    currentAdvancedPastFallbackStatus ||
    currentIncludesAtLeastFallbackContent ||
    currentMatchesBase ||
    currentReachedTerminal
  );
}

export interface Chat {
  _id: Id<"chats">;
  title?: string;
  mode: "chat" | "ideascape";
  activeBranchLeafId?: Id<"messages">;
  folderId?: string;
  isPinned?: boolean;
  pinnedAt?: number;
  temperatureOverride?: number | null;
  maxTokensOverride?: number | null;
  includeReasoningOverride?: boolean | null;
  reasoningEffortOverride?: string | null;
  autoAudioResponseOverride?: "enabled" | "disabled" | null;
  /** M30: layered skill overrides */
  skillOverrides?: Array<{ skillId: string; state: "always" | "available" | "never" }>;
  /** M30: layered integration overrides */
  integrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  subagentOverride?: "enabled" | "disabled";
  webSearchOverride?: boolean;
  searchModeOverride?: string;
  searchComplexityOverride?: number;
  createdAt: number;
  updatedAt?: number;
}

export interface ActiveJob {
  _id: Id<"generationJobs">;
  status: "queued" | "streaming";
  messageId?: Id<"messages">;
}

export interface SendMessageArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  text: string;
  participants: Participant[];
  attachments?: Array<{
    type: string;
    url?: string;
    storageId?: Id<"_storage">;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
    driveFileId?: string;
    lastRefreshedAt?: number;
    videoRole?: "first_frame" | "last_frame" | "reference";
  }>;
  recordedAudio?: {
    storageId: Id<"_storage">;
    transcript: string;
    durationMs?: number;
    mimeType?: string;
  };
  webSearchEnabled?: boolean;
  searchMode?: "normal" | "web";
  complexity?: number;
  enabledIntegrations?: string[];
  /** M30: turn-level skill overrides (from slash chips) */
  turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  /** M30: turn-level integration overrides (from slash chips) */
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
  subagentsEnabled?: boolean;
  videoConfig?: {
    duration?: number;
    aspectRatio?: string;
    resolution?: string;
    generateAudio?: boolean;
  };
}

function stripLocalParticipantFields(participant: Participant): Omit<Participant, "id"> {
  return {
    modelId: participant.modelId,
    personaId: participant.personaId,
    personaName: participant.personaName,
    personaEmoji: participant.personaEmoji,
    personaAvatarImageUrl: participant.personaAvatarImageUrl,
    systemPrompt: participant.systemPrompt,
    temperature: participant.temperature,
    maxTokens: participant.maxTokens,
    includeReasoning: participant.includeReasoning,
    reasoningEffort: participant.reasoningEffort,
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseChatReturn {
  chat: Chat | null | undefined;
  messages: Message[];
  activeJobs: ActiveJob[];
  isLoading: boolean;
  isGenerating: boolean;
  sendMessage: (args: SendMessageArgs) => Promise<{
    userMessageId: Id<"messages">;
    assistantMessageIds: Id<"messages">[];
  }>;
  cancelGeneration: (args: { chatId: Id<"chats"> }) => Promise<{ cancelledCount: number }>;
  retryMessage: (args: {
    messageId: Id<"messages">;
    participants?: Participant[];
    searchMode?: "normal" | "web";
    complexity?: number;
    enabledIntegrations?: string[];
    turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
    turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
    subagentsEnabled?: boolean;
    videoConfig?: {
      duration?: number;
      aspectRatio?: string;
      resolution?: string;
      generateAudio?: boolean;
    };
  }) => Promise<{ assistantMessageIds: Id<"messages">[] }>;
  deleteMessage: (args: { messageId: Id<"messages"> }) => Promise<null>;
  updateChat: (args: Partial<Chat> & { chatId: Id<"chats"> }) => Promise<null>;
  switchBranchAtFork: (args: {
    chatId: Id<"chats">;
    currentSiblingMessageId: Id<"messages">;
    targetSiblingMessageId: Id<"messages">;
  }) => Promise<Id<"messages">>;
}

export function useChat(chatId: Id<"chats"> | null | undefined): UseChatReturn {
  // ── Subscriptions ──────────────────────────────────────────────────────────
  const chat = useQuery(
    api.chat.queries.getChat,
    chatId ? { chatId } : "skip",
  ) as Chat | null | undefined;

  const rawMessages = useQuery(
    api.chat.queries.listMessages,
    chatId ? { chatId, limit: 500 } : "skip",
  );

  const streamingMessages = useQuery(
    api.chat.queries.listStreamingMessages,
    chatId ? { chatId } : "skip",
  ) as StreamingMessage[] | undefined;

  const activeJobs = useQuery(
    api.chat.queries.getActiveJobs,
    chatId ? { chatId } : "skip",
  ) as ActiveJob[] | undefined;

  // ── Derived state ──────────────────────────────────────────────────────────
  const messages = useMemo<Message[]>(
    () => {
      const mergeCache = getMergeCache(chatId);
      const base = (rawMessages as Message[] | undefined) ?? [];
      const overlays = new Map((streamingMessages ?? []).map((overlay) => [overlay.messageId, overlay]));
      const merged = base.map((message) => {
        const overlay = overlays.get(message._id);
        if (!overlay) return message;
        return {
          ...message,
          content: overlay.content,
          reasoning: overlay.reasoning,
          status: overlay.status,
          toolCalls: overlay.toolCalls ?? message.toolCalls,
        };
      });

      const previousById = new Map(
        mergeCache.previousMessages.map((message) => [message._id, message]),
      );
      const reconciled = merged.map((message) => {
        const previous = previousById.get(message._id);
        if (!previous) {
          mergeCache.pendingFallbackMessages.delete(message._id);
          return message;
        }
        const baseMessage = base.find((candidate) => candidate._id === message._id) ?? message;
        const pendingFallback = mergeCache.pendingFallbackMessages.get(message._id);

        // When the server transitions a message to a terminal status
        // (completed/failed/cancelled), it is authoritative — shorter
        // finalized content is an expected server transform (e.g. trimming
        // trailing whitespace deltas from models like kimi-k2), not a lost
        // overlay. Synthesizing a "streaming" fallback in that case would
        // strand isGenerating=true with no way to release, since the
        // fallback's length guard can never be satisfied.
        const finalizedToTerminal =
          message.status === "completed" ||
          message.status === "failed" ||
          message.status === "cancelled";

        const lostStreamingOverlay =
          !finalizedToTerminal &&
          previous.status === "streaming" &&
          message.status !== "streaming" &&
          message.content.length < previous.content.length;
        const lostCancelledOverlay =
          !finalizedToTerminal &&
          previous.status === "cancelled" &&
          message.status !== "cancelled" &&
          message.content.length < previous.content.length;

        if (lostStreamingOverlay || lostCancelledOverlay) {
          const fallback = mergeMessageWithFallback(previous, message);
          mergeCache.pendingFallbackMessages.set(message._id, fallback);
          return fallback;
        }

        if (
          pendingFallback &&
          shouldReleasePendingStreamingFallback(pendingFallback, previous, message, baseMessage)
        ) {
          mergeCache.pendingFallbackMessages.delete(message._id);
          return message;
        }

        if (pendingFallback) {
          return pendingFallback;
        }

        mergeCache.pendingFallbackMessages.delete(message._id);
        return message;
      });

      mergeCache.previousMessages = reconciled;
      return reconciled;
    },
    [rawMessages, streamingMessages, chatId],
  );

  const isLoading = chat === undefined || rawMessages === undefined;
  const isGenerating =
    (activeJobs?.length ?? 0) > 0 ||
    messages.some((message) => message.status === "streaming" || message.status === "pending");

  // ── Mutations ──────────────────────────────────────────────────────────────
  const sendMessageMutation = useMutation(api.chat.mutations.sendMessage);
  const cancelGenerationMutation = useMutation(
    api.chat.mutations.cancelActiveGeneration,
  );
  const retryMessageMutation = useMutation(api.chat.mutations.retryMessage);
  const deleteMessageMutation = useMutation(api.chat.manage.deleteMessage);
  const updateChatMutation = useMutation(api.chat.manage.updateChat);
  const switchBranchAtForkMutation = useMutation(api.chat.manage.switchBranchAtFork);

  // ── Action wrappers ────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    (args: SendMessageArgs) => sendMessageMutation({
      ...args,
      participants: args.participants.map(stripLocalParticipantFields),
    }),
    [sendMessageMutation],
  );

  const cancelGeneration = useCallback(
    (args: { chatId: Id<"chats"> }) =>
      cancelGenerationMutation({ chatId: args.chatId }),
    [cancelGenerationMutation],
  );

  const retryMessage = useCallback(
    (args: {
      messageId: Id<"messages">;
      participants?: Participant[];
      searchMode?: "normal" | "web";
      complexity?: number;
      enabledIntegrations?: string[];
      turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
      turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
      subagentsEnabled?: boolean;
      videoConfig?: {
        duration?: number;
        aspectRatio?: string;
        resolution?: string;
        generateAudio?: boolean;
      };
    }) => retryMessageMutation({
      ...args,
      participants: args.participants?.map(stripLocalParticipantFields),
    }),
    [retryMessageMutation],
  );

  const deleteMessage = useCallback(
    (args: { messageId: Id<"messages"> }) => deleteMessageMutation(args),
    [deleteMessageMutation],
  );

  const updateChat = useCallback(
    (args: Partial<Chat> & { chatId: Id<"chats"> }) =>
      updateChatMutation(args as Parameters<typeof updateChatMutation>[0]),
    [updateChatMutation],
  );

  const switchBranchAtFork = useCallback(
    (args: {
      chatId: Id<"chats">;
      currentSiblingMessageId: Id<"messages">;
      targetSiblingMessageId: Id<"messages">;
    }) => switchBranchAtForkMutation(args),
    [switchBranchAtForkMutation],
  );

  return {
    chat: chat ?? null,
    messages,
    activeJobs: (activeJobs as ActiveJob[]) ?? [],
    isLoading,
    isGenerating,
    sendMessage,
    cancelGeneration,
    retryMessage,
    deleteMessage,
    updateChat,
    switchBranchAtFork,
  };
}
