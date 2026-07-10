import type { Id } from "@convex/_generated/dataModel";
import type { Participant, SendMessageArgs } from "@/hooks/useChat";
import type { SharedPreferences } from "@/lib/chatRequestResolution";
import { analyticsErrorLabel, captureAnalytics, createAnalyticsClientMetadata } from "@/lib/analytics";
import { captureSendFeatureUsage } from "@/lib/featureAnalytics";
import type { AdvisorSelection } from "@/advisors/types";

export type ChatVideoRole = "first_frame" | "last_frame" | "reference";

export interface ChatAttachment {
  storageId?: Id<"_storage">;
  url?: string;
  name: string;
  type: string;
  mimeType: string;
  sizeBytes?: number;
  driveFileId?: string;
  lastRefreshedAt?: number;
  videoRole?: ChatVideoRole;
}

export interface RecordedAudioPayload {
  storageId: Id<"_storage">;
  transcript: string;
  durationMs?: number;
  mimeType?: string;
}

export interface RecordingResultPayload {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  transcript: string;
}

export interface TurnOverrideArgs {
  turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
}

export interface ChatSendOrchestrationState {
  chatId?: string;
  selectedAttachments: ChatAttachment[];
  kbAttachmentsForDisplay: ChatAttachment[];
  participants: Participant[];
  turnOverrideArgs: TurnOverrideArgs;
  enabledIntegrations: ReadonlySet<string>;
  subagentsEnabled: boolean;
  webSearchEnabled: boolean;
  convexSearchMode?: "normal" | "web";
  convexComplexity?: number;
  isResearchPaper: boolean;
  isVideoMode: boolean;
  prefs: SharedPreferences | undefined;
  advisorSelections?: AdvisorSelection[];
  advisorBrief?: string;
}

export interface ChatSendOrchestrationDeps {
  validateAttachmentCount: (attachmentCount: number) => string | null;
  ensureChatId: () => Promise<Id<"chats">>;
  flushPendingState: (chatId: Id<"chats">) => Promise<void>;
  sendMessage: (args: SendMessageArgs) => Promise<unknown>;
  startResearchPaper: (args: ReturnType<typeof buildResearchPaperArgs>) => Promise<unknown>;
  clearKBFiles: () => void;
  clearTurnOverrides: () => void;
}

export interface RecordedAudioOrchestrationDeps extends ChatSendOrchestrationDeps {
  createUploadUrl: () => Promise<string>;
  uploadRecording: (url: string, init: RequestInit) => Promise<Response>;
}

export function serializeChatAttachments(
  attachments: ChatAttachment[],
  options: { includeVideoRole: boolean },
): SendMessageArgs["attachments"] {
  return attachments.map((attachment) => ({
    type: attachment.type,
    storageId: attachment.storageId,
    url: attachment.url,
    name: attachment.name,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    driveFileId: attachment.driveFileId,
    lastRefreshedAt: attachment.lastRefreshedAt,
    ...(options.includeVideoRole ? { videoRole: attachment.videoRole } : {}),
  }));
}

type DedupeAttachment = {
  storageId?: unknown;
  driveFileId?: string;
  url?: string;
  name?: string;
  type?: string;
  mimeType?: string;
  sizeBytes?: number;
};

function attachmentDedupeKey(attachment: DedupeAttachment): string | null {
  if (attachment.storageId) return `storage:${String(attachment.storageId)}`;
  if (attachment.driveFileId) return `drive:${attachment.driveFileId}`;
  if (attachment.url) return `url:${attachment.url}`;
  if (attachment.name && attachment.mimeType) {
    return `file:${attachment.type ?? ""}:${attachment.name}:${attachment.mimeType}:${attachment.sizeBytes ?? ""}`;
  }
  return null;
}

function attachmentIsAudio(attachment: Pick<ChatAttachment, "type" | "mimeType">): boolean {
  return attachment.type === "audio" || attachment.mimeType.toLowerCase().startsWith("audio/");
}

function attachmentIsImage(attachment: Pick<ChatAttachment, "type" | "mimeType">): boolean {
  return attachment.type === "image" || attachment.mimeType.toLowerCase().startsWith("image/");
}

export function dedupeChatAttachments<T extends DedupeAttachment>(attachments: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const attachment of attachments) {
    const key = attachmentDedupeKey(attachment);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    deduped.push(attachment);
  }
  return deduped;
}

export function composerAttachmentState(args: {
  attachments?: ChatAttachment[];
  kbAttachmentsForDisplay: ChatAttachment[];
}): Pick<ChatSendOrchestrationState, "selectedAttachments" | "kbAttachmentsForDisplay"> {
  return {
    selectedAttachments: args.attachments ?? [],
    kbAttachmentsForDisplay: args.attachments === undefined ? args.kbAttachmentsForDisplay : [],
  };
}

export function buildVideoConfig(
  isVideoMode: boolean,
  prefs: SharedPreferences | undefined,
): SendMessageArgs["videoConfig"] | undefined {
  if (!isVideoMode) return undefined;
  return {
    aspectRatio: prefs?.defaultVideoAspectRatio ?? "16:9",
    duration: prefs?.defaultVideoDuration ?? 5,
    resolution: prefs?.defaultVideoResolution ?? "720p",
    generateAudio: prefs?.defaultVideoGenerateAudio ?? true,
  };
}

export function buildSendMessageArgs(args: {
  chatId: Id<"chats">;
  text: string;
  participants: Participant[];
  attachments: ChatAttachment[];
  recordedAudio?: RecordedAudioPayload;
  turnOverrideArgs: TurnOverrideArgs;
  enabledIntegrations: ReadonlySet<string>;
  subagentsEnabled: boolean;
  webSearchEnabled: boolean;
  convexSearchMode?: "normal" | "web";
  convexComplexity?: number;
  isVideoMode: boolean;
  prefs: SharedPreferences | undefined;
  advisorSelections?: AdvisorSelection[];
  advisorBrief?: string;
}): SendMessageArgs {
  return {
    chatId: args.chatId,
    text: args.text,
    participants: args.participants,
    attachments: serializeChatAttachments(args.attachments, { includeVideoRole: true }),
    ...(args.recordedAudio ? { recordedAudio: args.recordedAudio } : {}),
    ...args.turnOverrideArgs,
    ...(args.enabledIntegrations.size > 0
      ? { enabledIntegrations: Array.from(args.enabledIntegrations) }
      : {}),
    subagentsEnabled: args.subagentsEnabled,
    webSearchEnabled: args.webSearchEnabled,
    ...(args.convexSearchMode ? { searchMode: args.convexSearchMode } : {}),
    ...(args.convexComplexity ? { complexity: args.convexComplexity } : {}),
    ...(args.isVideoMode ? { videoConfig: buildVideoConfig(true, args.prefs) } : {}),
    ...(args.advisorSelections !== undefined ? { advisorSelections: args.advisorSelections } : {}),
    ...(args.advisorBrief ? { advisorBrief: args.advisorBrief } : {}),
  };
}

export function serializeResearchParticipant(participant: Participant) {
  return {
    modelId: participant.modelId,
    ...(participant.personaId !== undefined ? { personaId: participant.personaId } : {}),
    ...(participant.personaName !== undefined ? { personaName: participant.personaName } : {}),
    ...(participant.personaEmoji !== undefined ? { personaEmoji: participant.personaEmoji } : {}),
    ...(participant.personaAvatarImageUrl !== undefined
      ? { personaAvatarImageUrl: participant.personaAvatarImageUrl }
      : {}),
    ...(participant.systemPrompt !== undefined ? { systemPrompt: participant.systemPrompt } : {}),
    ...(participant.temperature !== undefined ? { temperature: participant.temperature } : {}),
    ...(participant.maxTokens !== undefined ? { maxTokens: participant.maxTokens } : {}),
    ...(participant.includeReasoning !== undefined ? { includeReasoning: participant.includeReasoning } : {}),
    ...(participant.reasoningEffort !== undefined ? { reasoningEffort: participant.reasoningEffort } : {}),
  };
}

export function buildResearchPaperArgs(args: {
  chatId: Id<"chats">;
  text: string;
  participant: Participant;
  complexity: number;
  attachments: ChatAttachment[];
  recordedAudio?: RecordedAudioPayload;
  enabledIntegrations: ReadonlySet<string>;
  advisorSelections?: AdvisorSelection[];
  advisorBrief?: string;
}) {
  return {
    chatId: args.chatId,
    text: args.text,
    participant: serializeResearchParticipant(args.participant),
    complexity: args.complexity,
    attachments: serializeChatAttachments(args.attachments, { includeVideoRole: false }),
    ...(args.recordedAudio ? { recordedAudio: args.recordedAudio } : {}),
    ...(args.enabledIntegrations.size > 0
      ? { enabledIntegrations: Array.from(args.enabledIntegrations) }
      : {}),
    ...(args.advisorSelections !== undefined ? { advisorSelections: args.advisorSelections } : {}),
    ...(args.advisorBrief ? { advisorBrief: args.advisorBrief } : {}),
    analytics: createAnalyticsClientMetadata("message_send_attempted", window.location.pathname),
  };
}

function researchPaperAnalyticsProperties(args: {
  chatId: Id<"chats">;
  text: string;
  participant: Participant;
  attachments: ChatAttachment[];
  recordedAudio?: RecordedAudioPayload;
  complexity: number;
  enabledIntegrations: ReadonlySet<string>;
  advisorSelections?: AdvisorSelection[];
  analytics: ReturnType<typeof createAnalyticsClientMetadata>;
}) {
  const hasAudioAttachment = args.attachments.some(attachmentIsAudio);
  const hasImageAttachment = args.attachments.some(attachmentIsImage);
  return {
    feature_area: "chat",
    chat_id: String(args.chatId),
    participant_count: 1,
    model_ids: args.participant.modelId,
    text_present: args.text.trim().length > 0,
    has_attachments: args.attachments.length > 0,
    attachment_count: args.attachments.length,
    has_audio: args.recordedAudio !== undefined || hasAudioAttachment,
    has_image_attachment: hasImageAttachment,
    audio_duration_ms: args.recordedAudio?.durationMs ?? null,
    web_search_enabled: true,
    search_mode: "paper",
    complexity: args.complexity,
    integration_count: args.enabledIntegrations.size,
    skill_override_count: 0,
    integration_override_count: 0,
    subagents_enabled: false,
    advisor_count: args.advisorSelections?.length ?? 0,
    advisor_web_search_count: args.advisorSelections?.filter((advisor) => advisor.allowWebSearch).length ?? 0,
    has_video_config: false,
    client_event_id: args.analytics.clientEventId,
  };
}

function researchPaperResultAnalyticsProperties(result: unknown) {
  if (typeof result !== "object" || result === null) {
    return {
      user_message_id: null,
      assistant_message_id: null,
      assistant_message_count: null,
    };
  }

  const paperResult = result as {
    userMessageId?: unknown;
    assistantMessageId?: unknown;
  };
  const userMessageId = typeof paperResult.userMessageId === "string" ? paperResult.userMessageId : null;
  const assistantMessageId = typeof paperResult.assistantMessageId === "string"
    ? paperResult.assistantMessageId
    : null;

  return {
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
    assistant_message_count: assistantMessageId ? 1 : null,
  };
}

async function startResearchPaperWithAnalytics(args: {
  chatId: Id<"chats">;
  text: string;
  participant: Participant;
  complexity: number;
  attachments: ChatAttachment[];
  recordedAudio?: RecordedAudioPayload;
  enabledIntegrations: ReadonlySet<string>;
  advisorSelections?: AdvisorSelection[];
  advisorBrief?: string;
  deps: ChatSendOrchestrationDeps;
}) {
  const mutationArgs = buildResearchPaperArgs(args);
  const properties = researchPaperAnalyticsProperties({
    ...args,
    analytics: mutationArgs.analytics,
  });
  captureAnalytics("message_send_attempted", properties);
  captureSendFeatureUsage(properties);
  try {
    const result = await args.deps.startResearchPaper(mutationArgs);
    captureAnalytics("message_sent", {
      ...properties,
      ...researchPaperResultAnalyticsProperties(result),
    });
    return result;
  } catch (error) {
    captureAnalytics("message_send_failed", {
      ...properties,
      failure_stage: "mutation",
      error_type: error instanceof Error ? error.name : "unknown",
      error_label: analyticsErrorLabel(error),
    });
    throw error;
  }
}

function captureRecordedAudioUploadFailure(args: {
  chatId: Id<"chats">;
  text: string;
  state: ChatSendOrchestrationState;
  attachments: ChatAttachment[];
  recording: RecordingResultPayload;
  error: unknown;
}) {
  const analytics = createAnalyticsClientMetadata("message_send_attempted", window.location.pathname);
  const properties = {
    feature_area: "chat",
    chat_id: String(args.chatId),
    text_present: args.text.trim().length > 0,
    participant_count: args.state.participants.length,
    model_ids: args.state.participants.map((participant) => participant.modelId).join(","),
    has_attachments: args.attachments.length > 0,
    attachment_count: args.attachments.length,
    has_audio: true,
    has_image_attachment: args.attachments.some(attachmentIsImage),
    audio_duration_ms: args.recording.durationMs,
    web_search_enabled: args.state.webSearchEnabled,
    search_mode: args.state.isResearchPaper ? "paper" : args.state.convexSearchMode ?? "none",
    complexity: args.state.convexComplexity ?? null,
    integration_count: args.state.enabledIntegrations.size,
    skill_override_count: args.state.turnOverrideArgs.turnSkillOverrides?.length ?? 0,
    integration_override_count: args.state.turnOverrideArgs.turnIntegrationOverrides?.length ?? 0,
    subagents_enabled: args.state.subagentsEnabled,
    has_video_config: args.state.isVideoMode,
    client_event_id: analytics.clientEventId,
  };
  captureAnalytics("message_send_attempted", properties);
  captureAnalytics("message_send_failed", {
    ...properties,
    failure_stage: "upload",
    error_type: args.error instanceof Error ? args.error.name : "unknown",
    error_label: analyticsErrorLabel(args.error),
  });
}

function captureSendValidationFailure(args: {
  chatId?: string;
  text: string;
  state: ChatSendOrchestrationState;
  attachments: ChatAttachment[];
  failureStage: "validation" | "recording_validation";
  errorLabel: string;
}) {
  const analytics = createAnalyticsClientMetadata("message_send_attempted", window.location.pathname);
  const hasAudioAttachment = args.attachments.some(attachmentIsAudio);
  const hasImageAttachment = args.attachments.some(attachmentIsImage);
  const properties = {
    feature_area: "chat",
    chat_id: args.chatId ? String(args.chatId) : null,
    text_present: args.text.trim().length > 0,
    participant_count: args.state.participants.length,
    model_ids: args.state.participants.map((participant) => participant.modelId).join(","),
    has_attachments: args.attachments.length > 0,
    attachment_count: args.attachments.length,
    has_audio: args.failureStage === "recording_validation" || hasAudioAttachment,
    has_image_attachment: hasImageAttachment,
    web_search_enabled: args.state.webSearchEnabled,
    search_mode: args.state.isResearchPaper ? "paper" : args.state.convexSearchMode ?? "none",
    complexity: args.state.convexComplexity ?? null,
    integration_count: args.state.enabledIntegrations.size,
    skill_override_count: args.state.turnOverrideArgs.turnSkillOverrides?.length ?? 0,
    integration_override_count: args.state.turnOverrideArgs.turnIntegrationOverrides?.length ?? 0,
    subagents_enabled: args.state.subagentsEnabled,
    has_video_config: args.state.isVideoMode,
    client_event_id: analytics.clientEventId,
  };
  captureAnalytics("message_send_attempted", properties);
  captureAnalytics("message_send_failed", {
    ...properties,
    failure_stage: args.failureStage,
    error_type: "validation",
    error_label: args.errorLabel,
  });
}

function capturePreSendSetupFailure(args: {
  chatId?: string;
  text: string;
  state: ChatSendOrchestrationState;
  attachments: ChatAttachment[];
  failureStage: "chat_setup" | "pending_state_flush";
  error: unknown;
  recordedAudio?: RecordingResultPayload;
}) {
  const analytics = createAnalyticsClientMetadata("message_send_attempted", window.location.pathname);
  const hasAudioAttachment = args.attachments.some(attachmentIsAudio);
  const hasImageAttachment = args.attachments.some(attachmentIsImage);
  const properties = {
    feature_area: "chat",
    chat_id: args.chatId ? String(args.chatId) : null,
    text_present: args.text.trim().length > 0,
    participant_count: args.state.participants.length,
    model_ids: args.state.participants.map((participant) => participant.modelId).join(","),
    has_attachments: args.attachments.length > 0,
    attachment_count: args.attachments.length,
    has_audio: args.recordedAudio !== undefined || hasAudioAttachment,
    has_image_attachment: hasImageAttachment,
    audio_duration_ms: args.recordedAudio?.durationMs ?? null,
    web_search_enabled: args.state.webSearchEnabled,
    search_mode: args.state.isResearchPaper ? "paper" : args.state.convexSearchMode ?? "none",
    complexity: args.state.convexComplexity ?? null,
    integration_count: args.state.enabledIntegrations.size,
    skill_override_count: args.state.turnOverrideArgs.turnSkillOverrides?.length ?? 0,
    integration_override_count: args.state.turnOverrideArgs.turnIntegrationOverrides?.length ?? 0,
    subagents_enabled: args.state.subagentsEnabled,
    has_video_config: args.state.isVideoMode,
    client_event_id: analytics.clientEventId,
  };
  captureAnalytics("message_send_attempted", properties);
  captureAnalytics("message_send_failed", {
    ...properties,
    failure_stage: args.failureStage,
    error_type: args.error instanceof Error ? args.error.name : "unknown",
    error_label: analyticsErrorLabel(args.error),
  });
}

async function prepareChatForSend(args: {
  state: ChatSendOrchestrationState;
  deps: ChatSendOrchestrationDeps;
  text: string;
  attachments: ChatAttachment[];
  recordedAudio?: RecordingResultPayload;
}): Promise<Id<"chats">> {
  let chatId: Id<"chats">;
  try {
    chatId = await args.deps.ensureChatId();
  } catch (error) {
    capturePreSendSetupFailure({
      chatId: args.state.chatId,
      text: args.text,
      state: args.state,
      attachments: args.attachments,
      recordedAudio: args.recordedAudio,
      failureStage: "chat_setup",
      error,
    });
    throw error;
  }

  try {
    await args.deps.flushPendingState(chatId);
  } catch (error) {
    capturePreSendSetupFailure({
      chatId,
      text: args.text,
      state: args.state,
      attachments: args.attachments,
      recordedAudio: args.recordedAudio,
      failureStage: "pending_state_flush",
      error,
    });
    throw error;
  }

  return chatId;
}

function validationErrorLabel(message: string | null): string {
  if (!message) return "validation_error";
  const normalized = message.toLowerCase();
  if (normalized.includes("research paper") && normalized.includes("single participant")) {
    return "research_paper_multi_participant";
  }
  if (normalized.includes("complexity 3") && normalized.includes("attachments")) {
    return "complexity_3_attachments";
  }
  return "validation_error";
}

export async function executeChatSend(
  args: {
    text: string;
    state: ChatSendOrchestrationState;
    deps: ChatSendOrchestrationDeps;
  },
): Promise<boolean> {
  const { text, state, deps } = args;
  const mergedAttachments = dedupeChatAttachments([
    ...state.selectedAttachments,
    ...state.kbAttachmentsForDisplay,
  ]);

  const validationMessage = deps.validateAttachmentCount(mergedAttachments.length);
  if (validationMessage) {
    captureSendValidationFailure({
      chatId: state.chatId,
      text,
      state,
      attachments: mergedAttachments,
      failureStage: "validation",
      errorLabel: validationErrorLabel(validationMessage),
    });
    return false;
  }

  const chatId = await prepareChatForSend({
    state,
    deps,
    text,
    attachments: mergedAttachments,
  });

  if (state.isResearchPaper) {
    const participant = state.participants[0];
    if (!participant) return false;
    await startResearchPaperWithAnalytics({
      chatId,
      text,
      participant,
      complexity: state.convexComplexity ?? 1,
      attachments: mergedAttachments,
      enabledIntegrations: state.enabledIntegrations,
      advisorSelections: state.advisorSelections,
      advisorBrief: state.advisorBrief,
      deps,
    });
  } else {
    await deps.sendMessage(buildSendMessageArgs({
      chatId,
      text,
      participants: state.participants,
      attachments: mergedAttachments,
      turnOverrideArgs: state.turnOverrideArgs,
      enabledIntegrations: state.enabledIntegrations,
      subagentsEnabled: state.subagentsEnabled,
      webSearchEnabled: state.webSearchEnabled,
      convexSearchMode: state.convexSearchMode,
      convexComplexity: state.convexComplexity,
      isVideoMode: state.isVideoMode,
      prefs: state.prefs,
      advisorSelections: state.advisorSelections,
      advisorBrief: state.advisorBrief,
    }));
  }

  deps.clearKBFiles();
  deps.clearTurnOverrides();
  return true;
}

export async function executeRecordedAudioSend(
  args: {
    recording: RecordingResultPayload;
    state: ChatSendOrchestrationState;
    deps: RecordedAudioOrchestrationDeps;
  },
): Promise<boolean> {
  const { recording, state, deps } = args;
  const mergedAttachments = dedupeChatAttachments([
    ...state.selectedAttachments,
    ...state.kbAttachmentsForDisplay,
  ]);

  const validationMessage = deps.validateAttachmentCount(mergedAttachments.length);
  if (validationMessage) {
    captureSendValidationFailure({
      chatId: state.chatId,
      text: recording.transcript || "(voice message)",
      state,
      attachments: mergedAttachments,
      failureStage: "recording_validation",
      errorLabel: validationErrorLabel(validationMessage),
    });
    return false;
  }

  const text = recording.transcript || "(voice message)";
  const chatId = await prepareChatForSend({
    state,
    deps,
    text,
    attachments: mergedAttachments,
    recordedAudio: recording,
  });
  let storageId: string;
  try {
    const uploadUrl = await deps.createUploadUrl();
    const response = await deps.uploadRecording(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": recording.mimeType },
      body: recording.blob,
    });
    if (!response.ok) {
      throw new Error("Voice recording upload failed.");
    }
    const parsed = (await response.json()) as { storageId?: string };
    if (!parsed.storageId) {
      throw new Error("Voice recording upload did not return a storage id.");
    }
    storageId = parsed.storageId;
  } catch (error) {
    captureRecordedAudioUploadFailure({
      chatId,
      text,
      state,
      attachments: mergedAttachments,
      recording,
      error,
    });
    throw error;
  }
  const recordedAudio: RecordedAudioPayload = {
    storageId: storageId as Id<"_storage">,
    transcript: recording.transcript,
    durationMs: recording.durationMs,
    mimeType: recording.mimeType,
  };

  if (state.isResearchPaper) {
    const participant = state.participants[0];
    if (!participant) return false;
    await startResearchPaperWithAnalytics({
      chatId,
      text,
      participant,
      complexity: state.convexComplexity ?? 1,
      attachments: mergedAttachments,
      recordedAudio,
      enabledIntegrations: state.enabledIntegrations,
      advisorSelections: state.advisorSelections,
      advisorBrief: state.advisorBrief,
      deps,
    });
  } else {
    await deps.sendMessage(buildSendMessageArgs({
      chatId,
      text,
      participants: state.participants,
      attachments: mergedAttachments,
      recordedAudio,
      turnOverrideArgs: state.turnOverrideArgs,
      enabledIntegrations: state.enabledIntegrations,
      subagentsEnabled: state.subagentsEnabled,
      webSearchEnabled: state.webSearchEnabled,
      convexSearchMode: state.convexSearchMode,
      convexComplexity: state.convexComplexity,
      isVideoMode: state.isVideoMode,
      prefs: state.prefs,
      advisorSelections: state.advisorSelections,
      advisorBrief: state.advisorBrief,
    }));
  }

  deps.clearKBFiles();
  deps.clearTurnOverrides();
  return true;
}
