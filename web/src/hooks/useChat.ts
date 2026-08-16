// hooks/useChat.ts
// Subscribes to all data needed to render a single chat.
// Mirrors iOS ChatViewModel's 8 concurrent subscriptions.

import { useCallback, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  createChatMergeCache,
  reconcileStreamingMessages,
} from "@/hooks/useChat.streaming";
import { useFirstVisibleResponseAnalytics } from "@/hooks/useChat.ttft";
import {
  analyticsErrorLabel,
  captureAnalytics,
  createAnalyticsClientMetadata,
} from "@/lib/analytics";
import { captureSendFeatureUsage } from "@/lib/featureAnalytics";
import type { AdvisorSelection } from "@/advisors/types";

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

/** Ephemeral target used to scope the next chat turn to a presentation artifact. */
export interface PresentationContext {
  projectId: string;
  projectRevision: number;
  slideId?: string;
  slideRevision?: number;
  elementId?: string;
}

export interface RetryContract {
  participants: Participant[];
  searchMode: "none" | "normal" | "web" | "paper";
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
  imageConfig?: {
    count?: number;
    aspectRatio?: string;
    resolution?: string;
    quality?: string;
    background?: string;
    outputFormat?: string;
    outputCompression?: number;
  };
}

export interface RetryAnalyticsSnapshot {
  participantCount: number | null;
  modelIds: string | null;
  searchMode: "none" | "normal" | "web" | "paper" | null;
  complexity: number | null;
  integrationCount: number;
  subagentsEnabled: boolean;
  hasVideoConfig: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  source?: "remote_mcp";
  displayName?: string;
  integrationId?: string;
  integrationName?: string;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
  isError?: boolean;
}

export interface PresentationGenerationProgress {
  phase: "queued" | "planning" | "repairing_plan" | "generating" |
    "repairing_generation" | "exporting" | "complete" | "failed";
  progress: number;
  title: string;
  slideCount?: number;
  error?: string;
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
  participantEmoji?: string;
  participantAvatarImageUrl?: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  activeToolCallIds?: string[];
  presentationProgress?: PresentationGenerationProgress;
  presentationContext?: PresentationContext;
  generatedFileIds?: Id<"generatedFiles">[];
  generatedChartIds?: Id<"generatedCharts">[];
  parentMessageIds?: Id<"messages">[];
  chatParticipantId?: Id<"chatParticipants">;
  collaborationExchangeId?: Id<"collaborationExchanges">;
  collaborationDecisionId?: Id<"collaborationDecisions">;
  collaborationWave?: number;
  collaborationReplyToIds?: Id<"messages">[];
  multiModelGroupId?: string;
  isMultiModelResponse?: boolean;
  subagentBatchId?: Id<"subagentBatches">;
  advisorBatchId?: Id<"advisorBatches">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
  moderatorDirective?: string;
  searchSessionId?: Id<"searchSessions">;
  loadedSkillIds?: Id<"skills">[];
  usedIntegrationIds?: string[];
  imageUrls?: string[];
  imageMimeTypes?: string[];
  imageGenerationExpectedCount?: number;
  imageGenerationResult?: {
    requestedCount: number;
    generatedCount: number;
    failedCount: number;
  };
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
  mcpInvocationIds?: string[];
  mcpContextCards?: Array<{
    invocationId: string;
    label: string;
    serverName: string;
    kind: "prompt" | "resource" | "resource_template";
  }>;
  audioStorageId?: Id<"_storage">;
  audioMimeType?: string;
  audioSource?: "recording" | "read_aloud" | "model_output";
  audioTranscript?: string;
  audioDurationMs?: number;
  audioGenerating?: boolean;
  citations?: Array<{ url: string; title: string }>;
  documentCitations?: Array<{
    ref: number;
    documentId?: Id<"documents">;
    versionId?: Id<"documentVersions">;
    filename: string;
    quote: string;
    page?: number | string;
    locator?: string;
  }>;
  documentEvents?: Array<{
    type: string;
    documentId: Id<"documents">;
    versionId?: Id<"documentVersions">;
    storageId?: Id<"_storage">;
    generatedFileId?: Id<"generatedFiles">;
    filename?: string;
    mimeType?: string;
    sizeBytes?: number;
    title?: string;
    summary?: string;
  }>;
  documentEditAnnotations?: Array<{
    type: "docx_edit_proposed";
    editId: Id<"documentEdits">;
    editBatchId: Id<"documentEditBatches">;
    generationKey: string;
    documentId: Id<"documents">;
    versionId: Id<"documentVersions">;
    baseVersionId: Id<"documentVersions">;
    introducedVersionId: Id<"documentVersions">;
    preResolutionVersionId?: Id<"documentVersions">;
    resolvedVersionId?: Id<"documentVersions">;
    generatedFileId?: Id<"generatedFiles">;
    filename: string;
    versionNumber: number;
    changeId: string;
    deletedText: string;
    insertedText: string;
    contextBefore?: string;
    contextAfter?: string;
    reason?: string;
    status: "pending" | "accepted" | "rejected";
    displayStatus: "pending" | "accepted" | "rejected" | "superseded" | "unavailable";
    canUndo: boolean;
    resolvedAt?: number;
    unavailableReason?: string;
  }>;
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
  toolResults?: ToolResult[];
  activeToolCallIds?: string[];
  presentationProgress?: PresentationGenerationProgress;
  updatedAt?: number;
}

export interface Chat {
  _id: Id<"chats">;
  title?: string;
  mode: "chat" | "ideascape";
  groupBehavior?: "parallel" | "collaboration";
  activeBranchLeafId?: Id<"messages">;
  activeBranchLeafFocusOrder?: number;
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

interface UpdateChatResult {
  activeBranchLeafApplied: boolean | null;
  activeBranchLeafId?: Id<"messages"> | null;
  activeBranchLeafFocusOrder?: number | null;
}

export type UpdateChatArgs = Partial<Chat> & {
  chatId: Id<"chats">;
  activeBranchLeafExpectedCurrentId?: Id<"messages"> | null;
  activeBranchLeafFocusOrder?: number;
};

export interface ActiveJob {
  _id: Id<"generationJobs">;
  status: "queued" | "streaming";
  messageId?: Id<"messages">;
}

export interface ExecutionProjection {
  runId: string;
  attemptId?: string;
  attemptNumber?: number;
  fence?: number;
  kind?: string;
  domainType?: string;
  domainId?: string;
  parentRunId?: string;
  state: string;
  placement: "cloud" | "local";
  executorKind?: string;
  runtimeLabel?: string;
  provider?: string;
  modelId?: string;
  phase?: string;
  progress?: number;
  checkpointRef?: string;
  leaseExpiresAt?: number;
  lastEventSequence?: number;
  lastEventType?: string;
  artifactIds?: string[];
  lastEventSummary?: string;
  updatedAt: number;
  cancelAvailable: boolean;
  cancelRequested: boolean;
  needsInput: boolean;
  needsPermission: boolean;
  terminalOutcome?: string;
  terminalSummary?: string;
}

export interface SendMessageArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  text: string;
  participants: Participant[];
  mentionedParticipantKeys?: string[];
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
  advisorSelections?: AdvisorSelection[];
  advisorBrief?: string;
  presentationContext?: PresentationContext;
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

function serializeSendParticipant(
  participant: Participant,
  index: number,
): Omit<Participant, "id"> & { participantKey: string } {
  return {
    participantKey: participant.id ?? String(index),
    ...stripLocalParticipantFields(participant),
  };
}

function sendAttachmentIsAudio(attachment: NonNullable<SendMessageArgs["attachments"]>[number]): boolean {
  return attachment.type === "audio" || attachment.mimeType?.toLowerCase().startsWith("audio/") === true;
}

function sendAttachmentIsImage(attachment: NonNullable<SendMessageArgs["attachments"]>[number]): boolean {
  return attachment.type === "image" || attachment.mimeType?.toLowerCase().startsWith("image/") === true;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseChatReturn {
  chat: Chat | null | undefined;
  messages: Message[];
  activeJobs: ActiveJob[];
  executionRuns: ExecutionProjection[];
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
    analyticsSnapshot?: RetryAnalyticsSnapshot;
  }) => Promise<{ assistantMessageIds: Id<"messages">[] }>;
  deleteMessage: (args: { messageId: Id<"messages"> }) => Promise<null>;
  updateChat: (args: UpdateChatArgs) => Promise<UpdateChatResult | null>;
  switchBranchAtFork: (args: {
    chatId: Id<"chats">;
    currentSiblingMessageId: Id<"messages">;
    targetSiblingMessageId: Id<"messages">;
  }) => Promise<Id<"messages">>;
}

export function useChat(chatId: Id<"chats"> | null | undefined): UseChatReturn {
  const mergeCache = useMemo(() => {
    void chatId;
    return createChatMergeCache();
  }, [chatId]);
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

  const executionRuns = useQuery(
    api.execution.queries.listMyRunProjections,
    chatId ? { chatId, limit: 50 } : "skip",
  ) as ExecutionProjection[] | undefined;

  // ── Derived state ──────────────────────────────────────────────────────────
  const messages = useMemo<Message[]>(
    () => {
      const base = (rawMessages as Message[] | undefined) ?? [];
      return reconcileStreamingMessages(mergeCache, base, streamingMessages);
    },
    [rawMessages, streamingMessages, mergeCache],
  );
  const registerFirstVisibleResponse = useFirstVisibleResponseAnalytics(
    chatId,
    messages,
  );

  const isLoading = chat === undefined || rawMessages === undefined;
  const legacyIsGenerating = (activeJobs?.length ?? 0) > 0 ||
    messages.some((message) => message.status === "streaming" || message.status === "pending");
  const isGenerating = executionRuns === undefined
    ? legacyIsGenerating
    : executionRuns.some((run) =>
        !run.cancelRequested &&
        !["completed", "failed", "cancelled"].includes(run.state)
      );

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
    async (args: SendMessageArgs) => {
      const sendStartedAtMs = Date.now();
      const analytics = createAnalyticsClientMetadata("message_send_attempted", window.location.pathname);
      const hasAudioAttachment = args.attachments?.some(sendAttachmentIsAudio) ?? false;
      const hasImageAttachment = args.attachments?.some(sendAttachmentIsImage) ?? false;
      const analyticsProperties = {
        feature_area: "chat",
        chat_id: String(args.chatId),
        participant_count: args.participants.length,
        model_ids: args.participants.map((participant) => participant.modelId).join(","),
        text_present: args.text.trim().length > 0,
        has_attachments: (args.attachments?.length ?? 0) > 0,
        attachment_count: args.attachments?.length ?? 0,
        has_audio: args.recordedAudio !== undefined || hasAudioAttachment,
        has_image_attachment: hasImageAttachment,
        audio_duration_ms: args.recordedAudio?.durationMs ?? null,
        web_search_enabled: args.webSearchEnabled === true,
        search_mode: args.searchMode ?? "none",
        complexity: args.complexity ?? null,
        integration_count: args.enabledIntegrations?.length ?? 0,
        skill_override_count: args.turnSkillOverrides?.length ?? 0,
        integration_override_count: args.turnIntegrationOverrides?.length ?? 0,
        subagents_enabled: args.subagentsEnabled === true,
        advisor_count: args.advisorSelections?.length ?? 0,
        advisor_web_search_count: args.advisorSelections?.filter((advisor) => advisor.allowWebSearch).length ?? 0,
        has_video_config: args.videoConfig !== undefined,
        client_event_id: analytics.clientEventId,
      };
      captureAnalytics("message_send_attempted", analyticsProperties);
      captureSendFeatureUsage(analyticsProperties);

      try {
        const result = await sendMessageMutation({
          ...args,
          presentationContext: args.presentationContext
            ? {
                ...args.presentationContext,
                projectId: args.presentationContext.projectId as Id<"presentationProjects">,
              }
            : undefined,
          analytics,
          participants: args.participants.map(serializeSendParticipant),
        });
        captureAnalytics("message_sent", {
          ...analyticsProperties,
          user_message_id: String(result.userMessageId),
          assistant_message_id: result.assistantMessageIds[0]
            ? String(result.assistantMessageIds[0])
            : null,
          assistant_message_ids: result.assistantMessageIds.map(String),
          assistant_message_count: result.assistantMessageIds.length,
        });
        registerFirstVisibleResponse({
          clientEventId: analytics.clientEventId,
          startedAtMs: sendStartedAtMs,
          mutationAckAtMs: Date.now(),
          assistantMessageIds: result.assistantMessageIds,
          modelIds: args.participants.map((participant) => participant.modelId),
          source: "send",
        });
        return result;
      } catch (error) {
        captureAnalytics("message_send_failed", {
          ...analyticsProperties,
          failure_stage: "mutation",
          error_type: error instanceof Error ? error.name : "unknown",
          error_label: analyticsErrorLabel(error),
        });
        throw error;
      }
    },
    [registerFirstVisibleResponse, sendMessageMutation],
  );

  const cancelGeneration = useCallback(
    async (args: { chatId: Id<"chats"> }) => {
      const result = await cancelGenerationMutation({ chatId: args.chatId });
      captureAnalytics("generation_cancelled", {
        feature_area: "chat",
        chat_id: String(args.chatId),
        cancelled_count: result.cancelledCount,
      });
      return result;
    },
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
      analyticsSnapshot?: RetryAnalyticsSnapshot;
    }) => {
      const retryStartedAtMs = Date.now();
      const analytics = createAnalyticsClientMetadata("message_retry_requested", window.location.pathname);
      const { analyticsSnapshot, ...retryArgs } = args;
      const participants = retryArgs.participants;
      const analyticsProperties = {
        feature_area: "chat",
        chat_id: chatId ? String(chatId) : null,
        message_id: String(retryArgs.messageId),
        participant_count: participants?.length ?? analyticsSnapshot?.participantCount ?? null,
        participant_count_source: participants ? "participant_override" : "retry_contract",
        model_ids: participants?.map((participant) => participant.modelId).join(",")
          ?? analyticsSnapshot?.modelIds
          ?? null,
        search_mode: retryArgs.searchMode ?? analyticsSnapshot?.searchMode ?? null,
        complexity: retryArgs.complexity ?? analyticsSnapshot?.complexity ?? null,
        integration_count: retryArgs.enabledIntegrations?.length ?? analyticsSnapshot?.integrationCount ?? 0,
        subagents_enabled: retryArgs.subagentsEnabled ?? analyticsSnapshot?.subagentsEnabled ?? false,
        has_video_config: retryArgs.videoConfig !== undefined || analyticsSnapshot?.hasVideoConfig === true,
        client_event_id: analytics.clientEventId,
      };
      captureAnalytics("message_retry_requested", analyticsProperties);
      return retryMessageMutation({
        ...retryArgs,
        analytics,
        participants: participants?.map(stripLocalParticipantFields),
      }).then((result) => {
        registerFirstVisibleResponse({
          clientEventId: analytics.clientEventId,
          startedAtMs: retryStartedAtMs,
          mutationAckAtMs: Date.now(),
          assistantMessageIds: result.assistantMessageIds,
          modelIds: participants?.map((participant) => participant.modelId)
            ?? analyticsSnapshot?.modelIds?.split(",")
            ?? [],
          source: "retry",
        });
        return result;
      }).catch((error: unknown) => {
          captureAnalytics("message_retry_failed", {
            ...analyticsProperties,
            error_type: error instanceof Error ? error.name : "unknown",
            error_label: analyticsErrorLabel(error),
          });
          throw error;
        });
    },
    [chatId, registerFirstVisibleResponse, retryMessageMutation],
  );

  const deleteMessage = useCallback(
    async (args: { messageId: Id<"messages"> }) => {
      const result = await deleteMessageMutation(args);
      captureAnalytics("response_deleted", {
        feature_area: "chat",
        message_id: String(args.messageId),
      });
      return result;
    },
    [deleteMessageMutation],
  );

  const updateChat = useCallback(
    (args: UpdateChatArgs) =>
      updateChatMutation(args as Parameters<typeof updateChatMutation>[0]),
    [updateChatMutation],
  );

  const switchBranchAtFork = useCallback(
    (args: {
      chatId: Id<"chats">;
      currentSiblingMessageId: Id<"messages">;
      targetSiblingMessageId: Id<"messages">;
    }) => {
      return switchBranchAtForkMutation(args).then((nextLeafId) => {
        captureAnalytics("feature_used", {
          feature_area: "chat",
          feature: "branching",
          action: "branch_switched",
          chat_id: String(args.chatId),
          message_id: String(args.targetSiblingMessageId),
        });
        return nextLeafId;
      });
    },
    [switchBranchAtForkMutation],
  );

  return {
    chat: chat ?? null,
    messages,
    activeJobs: (activeJobs as ActiveJob[]) ?? [],
    executionRuns: executionRuns ?? [],
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
