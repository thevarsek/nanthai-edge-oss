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

export interface TurnOverrideArgs {
  turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
  turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
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
    participant: args.participant,
    complexity: args.complexity,
    attachments: serializeChatAttachments(args.attachments, { includeVideoRole: false }),
    ...(args.recordedAudio ? { recordedAudio: args.recordedAudio } : {}),
    ...(args.enabledIntegrations.size > 0
      ? { enabledIntegrations: Array.from(args.enabledIntegrations) }
      : {}),
  };
}
