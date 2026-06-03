import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message, Participant } from "@/hooks/useChat";
import {
  documentAnnotationBelongsToGeneratedFile,
  getRetryBaseParticipant,
  latestDrivePickerRequest,
  liveDocumentPreviewAnnotations,
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

function documentEditAnnotation(
  overrides: Partial<NonNullable<Message["documentEditAnnotations"]>[number]> = {},
): NonNullable<Message["documentEditAnnotations"]>[number] {
  return {
    type: "docx_edit_proposed",
    editId: "edit_1" as Id<"documentEdits">,
    editBatchId: "batch_edit_1" as Id<"documentEditBatches">,
    generationKey: "gen_1",
    documentId: "document_1" as Id<"documents">,
    versionId: "version_current" as Id<"documentVersions">,
    baseVersionId: "version_base" as Id<"documentVersions">,
    introducedVersionId: "version_intro" as Id<"documentVersions">,
    filename: "Draft.docx",
    versionNumber: 2,
    changeId: "change_1",
    deletedText: "old",
    insertedText: "new",
    status: "pending",
    displayStatus: "pending",
    canUndo: false,
    ...overrides,
  };
}

describe("ChatPage flow helpers", () => {
  it("parses completed assistant drive picker requests", () => {
    expect(parseDrivePickerRequest(message({ status: "completed", drivePickerBatchId: batchId }))).toEqual({
      key: `${messageId}:${batchId}`,
      batchId,
    });
  });

  it("ignores missing, non-assistant, resumed, and terminal drive picker requests", () => {
    expect(parseDrivePickerRequest(undefined)).toBeNull();
    expect(parseDrivePickerRequest(message({ role: "user", drivePickerBatchId: batchId }))).toBeNull();
    expect(parseDrivePickerRequest(message({ status: "pending", drivePickerBatchId: batchId }))).toBeNull();
    expect(parseDrivePickerRequest(message({ status: "streaming", drivePickerBatchId: batchId }))).toBeNull();
    expect(parseDrivePickerRequest(message({ status: "failed", drivePickerBatchId: batchId }))).toBeNull();
    expect(parseDrivePickerRequest(message({ status: "cancelled", drivePickerBatchId: batchId }))).toBeNull();
  });

  it("returns the latest active drive picker request", () => {
    const oldBatch = "batch_old" as Id<"drivePickerBatches">;
    const latestBatch = "batch_latest" as Id<"drivePickerBatches">;
    const request = latestDrivePickerRequest([
      message({ _id: "old" as Id<"messages">, status: "completed", drivePickerBatchId: oldBatch }),
      message({ _id: "failed" as Id<"messages">, drivePickerBatchId: latestBatch, status: "failed" }),
      message({ _id: "latest" as Id<"messages">, status: "completed", drivePickerBatchId: latestBatch }),
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
      participantEmoji: "A",
      participantAvatarImageUrl: "https://example.com/avatar.png",
    }))).toMatchObject({
      modelId: "openai/gpt-5.2",
      personaId: "persona_2",
      personaName: "Analyst",
      personaEmoji: "A",
      personaAvatarImageUrl: "https://example.com/avatar.png",
      systemPrompt: null,
      reasoningEffort: null,
    });
  });

  it("scopes generated file annotations by generated file id or matching document version", () => {
    const targetFile = {
      _id: "generated_file_1",
      documentVersionId: "version_intro",
    };
    const matchingGeneratedFile = documentEditAnnotation({
      generatedFileId: "generated_file_1" as Id<"generatedFiles">,
    });
    const matchingLegacyVersion = documentEditAnnotation({
      editId: "edit_2" as Id<"documentEdits">,
      introducedVersionId: "version_intro" as Id<"documentVersions">,
    });
    const unrelatedLegacyAnnotation = documentEditAnnotation({
      editId: "edit_3" as Id<"documentEdits">,
      introducedVersionId: "version_other" as Id<"documentVersions">,
      versionId: "version_other" as Id<"documentVersions">,
      baseVersionId: "version_other_base" as Id<"documentVersions">,
    });

    expect(documentAnnotationBelongsToGeneratedFile(matchingGeneratedFile, targetFile)).toBe(true);
    expect(documentAnnotationBelongsToGeneratedFile(matchingLegacyVersion, targetFile)).toBe(true);
    expect(documentAnnotationBelongsToGeneratedFile(unrelatedLegacyAnnotation, targetFile)).toBe(false);
  });

  it("live document preview annotations prefer focused edit batch over generated file scope", () => {
    const batchAnnotation = documentEditAnnotation({
      editId: "edit_batch" as Id<"documentEdits">,
      editBatchId: "batch_edit_2" as Id<"documentEditBatches">,
      generatedFileId: "generated_file_1" as Id<"generatedFiles">,
    });
    const otherGeneratedFileAnnotation = documentEditAnnotation({
      editId: "edit_other" as Id<"documentEdits">,
      editBatchId: "batch_edit_3" as Id<"documentEditBatches">,
      generatedFileId: "generated_file_1" as Id<"generatedFiles">,
    });

    expect(liveDocumentPreviewAnnotations({
      liveAnnotations: [batchAnnotation, otherGeneratedFileAnnotation],
      selectedAnnotations: [batchAnnotation],
      generatedFileId: "generated_file_1",
      focusEditId: "edit_batch",
      focusEditBatchId: "batch_edit_2",
    }).map((annotation) => annotation.editId)).toEqual(["edit_batch"]);
  });
});
