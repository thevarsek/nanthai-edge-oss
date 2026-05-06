import type { Id } from "@convex/_generated/dataModel";
import { Defaults } from "@/lib/constants";
import type { Message, Participant } from "@/hooks/useChat";

export interface DrivePickerRequest {
  key: string;
  batchId: Id<"drivePickerBatches">;
}

export function parseDrivePickerRequest(message: Message | undefined): DrivePickerRequest | null {
  if (!message || message.role !== "assistant" || !message.drivePickerBatchId) return null;
  if (message.status === "failed" || message.status === "cancelled") return null;
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
    personaEmoji: null,
    personaName: message?.participantName ?? null,
    personaAvatarImageUrl: message?.participantAvatarImageUrl ?? null,
    systemPrompt: null,
    temperature: undefined,
    maxTokens: undefined,
    includeReasoning: undefined,
    reasoningEffort: null,
  };
}
