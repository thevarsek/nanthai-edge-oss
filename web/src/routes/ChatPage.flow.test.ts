import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message, Participant } from "@/hooks/useChat";
import {
  getRetryBaseParticipant,
  latestDrivePickerRequest,
  parseDrivePickerRequest,
} from "./ChatPage.flow";

const messageId = "msg_1" as Id<"messages">;
const chatId = "chat_1" as Id<"chats">;
const batchId = "batch_1" as Id<"drivePickerBatches">;

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: messageId,
    _creationTime: 1,
    chatId,
    role: "assistant",
    content: "",
    status: "streaming",
    createdAt: 1,
    ...overrides,
  };
}

describe("ChatPage flow helpers", () => {
  it("parses active assistant drive picker requests", () => {
    expect(parseDrivePickerRequest(message({ drivePickerBatchId: batchId }))).toEqual({
      key: `${messageId}:${batchId}`,
      batchId,
    });
  });

  it("ignores missing, non-assistant, failed, and cancelled drive picker requests", () => {
    expect(parseDrivePickerRequest(undefined)).toBeNull();
    expect(parseDrivePickerRequest(message({ role: "user", drivePickerBatchId: batchId }))).toBeNull();
    expect(parseDrivePickerRequest(message({ status: "failed", drivePickerBatchId: batchId }))).toBeNull();
    expect(parseDrivePickerRequest(message({ status: "cancelled", drivePickerBatchId: batchId }))).toBeNull();
  });

  it("returns the latest active drive picker request", () => {
    const oldBatch = "batch_old" as Id<"drivePickerBatches">;
    const latestBatch = "batch_latest" as Id<"drivePickerBatches">;
    const request = latestDrivePickerRequest([
      message({ _id: "old" as Id<"messages">, drivePickerBatchId: oldBatch }),
      message({ _id: "failed" as Id<"messages">, drivePickerBatchId: latestBatch, status: "failed" }),
      message({ _id: "latest" as Id<"messages">, drivePickerBatchId: latestBatch }),
    ]);

    expect(request).toEqual({
      key: `latest:${latestBatch}`,
      batchId: latestBatch,
    });
  });

  it("prefers retry contract participant for retry base", () => {
    const participant: Participant = {
      modelId: "anthropic/claude-sonnet-4",
      personaId: "persona_1" as Id<"personas">,
      personaName: "Researcher",
      personaEmoji: "R",
      personaAvatarImageUrl: null,
      systemPrompt: "system",
      temperature: 0.5,
      maxTokens: 2048,
      includeReasoning: true,
      reasoningEffort: "high",
    };

    expect(getRetryBaseParticipant(message({
      retryContract: {
        participants: [participant],
        searchMode: "web",
      },
    }))).toEqual(participant);
  });

  it("falls back to message model and participant metadata for retry base", () => {
    expect(getRetryBaseParticipant(message({
      modelId: "openai/gpt-5.2",
      participantId: "persona_2",
      participantName: "Analyst",
      participantAvatarImageUrl: "https://example.com/avatar.png",
    }))).toMatchObject({
      modelId: "openai/gpt-5.2",
      personaId: "persona_2",
      personaName: "Analyst",
      personaAvatarImageUrl: "https://example.com/avatar.png",
      systemPrompt: null,
      reasoningEffort: null,
    });
  });
});
