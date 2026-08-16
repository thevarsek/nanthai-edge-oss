import type { Doc, Id } from "../_generated/dataModel";

type CopiedMessageInsert = Omit<Doc<"messages">, "_id" | "_creationTime">;

export function normalizeCopiedStatus(
  status: Doc<"messages">["status"],
): Doc<"messages">["status"] {
  return status === "streaming" || status === "pending"
    ? "completed"
    : status;
}

export function buildCopiedMessageInsert(
  message: Doc<"messages">,
  chatId: Id<"chats">,
  parentMessageIds: Id<"messages">[],
): CopiedMessageInsert {
  return {
    chatId,
    role: message.role,
    content: message.content,
    modelId: message.modelId,
    participantId: message.participantId,
    participantName: message.participantName,
    participantEmoji: message.participantEmoji,
    participantAvatarImageUrl: message.participantAvatarImageUrl,
    autonomousParticipantId: message.autonomousParticipantId,
    parentMessageIds,
    multiModelGroupId: message.multiModelGroupId,
    isMultiModelResponse: message.isMultiModelResponse,
    status: normalizeCopiedStatus(message.status),
    reasoning: message.reasoning,
    usage: message.usage,
    imageUrls: message.imageUrls,
    imageMimeTypes: message.imageMimeTypes,
    imageGenerationExpectedCount: message.imageGenerationExpectedCount,
    imageGenerationResult: message.imageGenerationResult,
    videoUrls: message.videoUrls,
    audioStorageId: message.audioStorageId,
    audioMimeType: message.audioMimeType,
    audioSource: message.audioSource,
    audioTranscript: message.audioTranscript,
    audioDurationMs: message.audioDurationMs,
    audioVoice: message.audioVoice,
    audioGeneratedAt: message.audioGeneratedAt,
    attachments: message.attachments,
    retryContract: message.retryContract,
    terminalErrorCode: message.terminalErrorCode,
    createdAt: message.createdAt,
  };
}
