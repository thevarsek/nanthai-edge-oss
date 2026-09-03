import assert from "node:assert/strict";
import test from "node:test";

import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { registerGeneratedFilesForToolRound } from
  "../chat/generated_file_registration";
import {
  insertGeneratedAudioFile,
  insertGeneratedMediaBatch,
} from "../tools/media_generation_mutations";
import { createToolVideoJobHandler } from "../tools/video_generation_mutations";

function operationRows(operationKey: string) {
  return {
    chats: [{ _id: "chat_1", userId: "user_1" }],
    messages: [
      {
        _id: "message_1",
        userId: "user_1",
        chatId: "chat_1",
        generatedFileIds: undefined as string[] | undefined,
      },
      { _id: "source_1", userId: "user_1", chatId: "chat_1" },
    ],
    generationJobs: [{
      _id: "job_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      status: "streaming",
    }],
    executionRuns: [{
      _id: "run_1",
      activeAttemptId: "attempt_1",
      userId: "user_1",
      chatId: "chat_1",
      state: "running",
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      fence: 1,
      status: "running",
    }],
    executionOperations: [{
      _id: "operation_1",
      runId: "run_1",
      attemptId: "attempt_1",
      operationKey,
      status: "dispatching",
      resultJson: undefined as string | undefined,
    }],
    accountDeletionTombstones: [],
    generatedMedia: [],
    generatedFiles: [],
    videoJobs: [],
  };
}

test("image artifact insertion atomically adopts the replayable tool result", async () => {
  const rows = operationRows("image_operation");
  const ctx = createStatefulMockCtx(rows);
  const resultJson = JSON.stringify({
    success: true,
    data: { kind: "image", imageUrls: ["https://files.example/image.png"] },
  });

  const args = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1",
    executionFence: 1,
    operationKey: "image_operation",
    operationResultJson: resultJson,
    media: [{
      storageId: "storage_image",
      type: "image",
      mimeType: "image/png",
    }],
  };
  const first = await (insertGeneratedMediaBatch as any)._handler(ctx, args);
  const second = await (insertGeneratedMediaBatch as any)._handler(ctx, args);

  assert.equal(rows.generatedMedia.length, 1);
  assert.deepEqual(second, first);
  assert.equal(rows.executionOperations[0]?.status, "succeeded");
  assert.equal(rows.executionOperations[0]?.resultJson, resultJson);
});

test("audio file insertion atomically adopts a result containing its generated file ID", async () => {
  const rows = operationRows("speech_operation");
  const ctx = createStatefulMockCtx(rows);

  const persisted = await (insertGeneratedAudioFile as any)._handler(ctx, {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1",
    executionFence: 1,
    operationKey: "speech_operation",
    operationResultDataJson: JSON.stringify({
      kind: "speech",
      audioStorageId: "storage_audio",
      audioUrl: "https://files.example/audio.mp3",
    }),
    storageId: "storage_audio",
    filename: "speech.mp3",
    mimeType: "audio/mpeg",
    sizeBytes: 42,
    toolName: "generate_speech",
  });

  assert.equal(rows.generatedFiles.length, 1);
  assert.equal(rows.executionOperations[0]?.status, "succeeded");
  assert.equal(JSON.parse(persisted.resultJson).data.generatedFileId, persisted.generatedFileId);
  assert.equal(rows.executionOperations[0]?.resultJson, persisted.resultJson);
});

test("video job creation atomically adopts the deferred tool result", async () => {
  const rows = operationRows("video_operation");
  const ctx = createStatefulMockCtx(rows);

  const args = {
    userId: "user_1",
    chatId: "chat_1" as never,
    messageId: "message_1" as never,
    sourceUserMessageId: "source_1" as never,
    generationJobId: "job_1" as never,
    toolCallId: "video_call",
    toolOperationKey: "video_operation",
    model: "provider/video-model",
    prompt: "A slow tracking shot",
    videoConfig: { duration: 5 },
    requireZdr: false,
    executionAttemptId: "attempt_1" as never,
    executionFence: 1,
  };
  const persisted = await createToolVideoJobHandler(ctx as never, args);
  const repeated = await createToolVideoJobHandler(ctx as never, args);

  assert.equal(rows.videoJobs.length, 1);
  assert.equal(repeated.videoJobId, persisted.videoJobId);
  assert.equal(repeated.resultJson, persisted.resultJson);
  assert.equal(rows.executionOperations[0]?.status, "succeeded");
  const replay = JSON.parse(persisted.resultJson);
  assert.equal(replay.data.videoJobId, persisted.videoJobId);
  assert.equal(replay.deferred.kind, "video_generation");
  assert.equal(rows.executionOperations[0]?.resultJson, persisted.resultJson);
});

test("a completed tool round immediately authorizes generated files for the next tool", async () => {
  const rows = operationRows("image_operation");
  const ctx = createStatefulMockCtx(rows);
  const args = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1",
    executionFence: 1,
    files: [{
      storageId: "storage_image",
      filename: "generated-image.png",
      mimeType: "image/png",
      sizeBytes: 42,
      toolName: "generate_image",
    }],
  };

  const first = await (registerGeneratedFilesForToolRound as any)._handler(ctx, args);
  const second = await (registerGeneratedFilesForToolRound as any)._handler(ctx, args);

  assert.deepEqual(first, ["generatedFiles_1"]);
  assert.deepEqual(second, first);
  assert.equal(rows.generatedFiles.length, 1);
  assert.deepEqual(rows.messages[0]?.generatedFileIds, first);
});
