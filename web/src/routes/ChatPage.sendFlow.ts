import type { Id } from "@convex/_generated/dataModel";
import type { Participant, SendMessageArgs } from "@/hooks/useChat";
import type { SharedPreferences } from "@/lib/chatRequestResolution";

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
}

export interface ChatSendOrchestrationDeps {
  validateAttachmentCount: (attachmentCount: number) => boolean;
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
  };
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

  if (!deps.validateAttachmentCount(mergedAttachments.length)) {
    return false;
  }

  const chatId = await deps.ensureChatId();
  await deps.flushPendingState(chatId);

  if (state.isResearchPaper) {
    const participant = state.participants[0];
    if (!participant) return false;
    await deps.startResearchPaper(buildResearchPaperArgs({
      chatId,
      text,
      participant,
      complexity: state.convexComplexity ?? 1,
      attachments: mergedAttachments,
      enabledIntegrations: state.enabledIntegrations,
    }));
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

  if (!deps.validateAttachmentCount(mergedAttachments.length)) {
    return false;
  }

  const chatId = await deps.ensureChatId();
  await deps.flushPendingState(chatId);
  const uploadUrl = await deps.createUploadUrl();
  const response = await deps.uploadRecording(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": recording.mimeType },
    body: recording.blob,
  });
  if (!response.ok) {
    throw new Error("Voice recording upload failed.");
  }
  const { storageId } = (await response.json()) as { storageId?: string };
  if (!storageId) {
    throw new Error("Voice recording upload did not return a storage id.");
  }
  const recordedAudio: RecordedAudioPayload = {
    storageId: storageId as Id<"_storage">,
    transcript: recording.transcript,
    durationMs: recording.durationMs,
    mimeType: recording.mimeType,
  };
  const text = recording.transcript || "(voice message)";

  if (state.isResearchPaper) {
    const participant = state.participants[0];
    if (!participant) return false;
    await deps.startResearchPaper(buildResearchPaperArgs({
      chatId,
      text,
      participant,
      complexity: state.convexComplexity ?? 1,
      attachments: mergedAttachments,
      recordedAudio,
      enabledIntegrations: state.enabledIntegrations,
    }));
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
    }));
  }

  deps.clearKBFiles();
  deps.clearTurnOverrides();
  return true;
}
