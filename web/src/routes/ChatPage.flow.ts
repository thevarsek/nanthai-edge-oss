import type { Id } from "@convex/_generated/dataModel";
import { Defaults } from "@/lib/constants";
import type { Message, Participant } from "@/hooks/useChat";

type DocumentEditAnnotation = NonNullable<Message["documentEditAnnotations"]>[number];

export type GeneratedFileAnnotationTarget = {
  _id: string;
  documentVersionId?: string | null;
};

export interface DrivePickerRequest {
  key: string;
  batchId: Id<"drivePickerBatches">;
}

export function parseDrivePickerRequest(message: Message | undefined): DrivePickerRequest | null {
  if (!message || message.role !== "assistant" || !message.drivePickerBatchId) return null;
  if (message.status !== "completed") return null;
  return { key: `${message._id}:${message.drivePickerBatchId}`, batchId: message.drivePickerBatchId };
}

export function latestDrivePickerRequest(messages: Message[]): DrivePickerRequest | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const request = parseDrivePickerRequest(messages[index]);
    if (request) return request;
  }
  return null;
}

export function getRetryBaseParticipant(message: Message | undefined): Participant {
  return message?.retryContract?.participants[0] ?? {
    modelId: message?.modelId ?? Defaults.model,
    personaId: (message?.participantId as Id<"personas"> | undefined) ?? null,
    personaEmoji: message?.participantEmoji ?? null,
    personaName: message?.participantName ?? null,
    personaAvatarImageUrl: message?.participantAvatarImageUrl ?? null,
    systemPrompt: null,
    temperature: undefined,
    maxTokens: undefined,
    includeReasoning: undefined,
    reasoningEffort: null,
  };
}

export function documentAnnotationVersionMatches(
  annotation: DocumentEditAnnotation,
  versionId: string | undefined | null,
): boolean {
  if (!versionId) return false;
  return annotation.versionId === versionId ||
    annotation.baseVersionId === versionId ||
    annotation.introducedVersionId === versionId ||
    annotation.preResolutionVersionId === versionId ||
    annotation.resolvedVersionId === versionId;
}

export function documentAnnotationBelongsToGeneratedFile(
  annotation: DocumentEditAnnotation,
  file: GeneratedFileAnnotationTarget,
): boolean {
  if (annotation.generatedFileId === file._id) return true;
  if (annotation.generatedFileId) return false;
  return documentAnnotationVersionMatches(annotation, file.documentVersionId);
}

export function liveDocumentPreviewAnnotations(args: {
  liveAnnotations: DocumentEditAnnotation[];
  selectedAnnotations: DocumentEditAnnotation[];
  generatedFileId?: string;
  versionId?: string;
  focusEditId?: string;
  focusEditBatchId?: string;
}): DocumentEditAnnotation[] {
  const {
    liveAnnotations,
    selectedAnnotations,
    generatedFileId,
    versionId,
    focusEditId,
    focusEditBatchId,
  } = args;

  if (focusEditBatchId) {
    return liveAnnotations.filter((annotation) =>
      annotation.editBatchId === focusEditBatchId || annotation.editId === focusEditId
    );
  }

  if (generatedFileId) {
    return liveAnnotations.filter((annotation) =>
      annotation.generatedFileId === generatedFileId ||
      (!annotation.generatedFileId && documentAnnotationVersionMatches(annotation, versionId))
    );
  }

  const selectedEditIds = new Set(selectedAnnotations.map((annotation) => annotation.editId));
  return liveAnnotations.filter((annotation) => selectedEditIds.has(annotation.editId));
}
