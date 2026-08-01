import assert from "node:assert/strict";
import test from "node:test";

import {
  markChatCompletionNotifiedHandler,
  patchMessageAudioHandler,
  updateJobStatusHandler,
  updateMessageContentHandler,
  updateMessageReasoningHandler,
  updateMessageToolCallsHandler,
} from "../chat/mutations_internal_handlers";
import {
  createVideoJobHandler,
  insertGeneratedMediaHandler,
  updateVideoJobPollHandler,
  updateVideoJobStatusHandler,
} from "../chat/video_mutation_handlers";

function buildCtx(records: Record<string, Record<string, unknown>> = {}) {
  const rows = new Map(Object.entries(records));
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const deletes: string[] = [];
  const storageDeletes: string[] = [];
  return {
    rows,
    patches,
    inserts,
    deletes,
    storageDeletes,
    ctx: {
      db: {
        get: async (id: string) => rows.get(id) ?? null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
          rows.set(id, { ...(rows.get(id) ?? { _id: id }), ...patch });
        },
        insert: async (table: string, value: Record<string, unknown>) => {
          const id = `${table}_${inserts.length + 1}`;
          inserts.push({ table, value, id });
          rows.set(id, { _id: id, ...value });
          return id;
        },
        delete: async (id: string) => {
          deletes.push(id);
          rows.delete(id);
        },
        query: (table: string) => ({
          withIndex: (_index: string, apply?: (q: any) => unknown) => {
            let messageId: unknown;
            const q = {
              eq: (field: string, value: unknown) => {
                if (field === "messageId") messageId = value;
                return q;
              },
            };
            apply?.(q);
            return {
            first: async () => null,
            collect: async () => table === "streamingMessages"
              ? Array.from(rows.values()).filter((row) =>
                row.table === "streamingMessages" && row.messageId === messageId)
              : [],
            };
          },
        }),
      },
      storage: {
        delete: async (id: string) => {
          storageDeletes.push(id);
          if (id === "audio_throw") throw new Error("already removed");
        },
      },
    } as never,
  };
}

test("message metadata handlers no-op for absent or terminal rows and mark completion once", async () => {
  const state = buildCtx({
    trigger: { _id: "trigger", status: "completed" },
    notified: { _id: "notified", chatCompletionNotifiedAt: 10 },
    done: { _id: "done", status: "failed" },
  });

  await updateMessageReasoningHandler(state.ctx, {
    messageId: "missing",
    reasoning: "ignored",
  } as never);
  await updateMessageToolCallsHandler(state.ctx, {
    messageId: "done",
    toolCalls: [{ id: "call_1", name: "read_document", arguments: "{}" }],
  } as never);
  assert.equal(await markChatCompletionNotifiedHandler(state.ctx, { messageId: "missing" } as never), false);
  assert.equal(await markChatCompletionNotifiedHandler(state.ctx, { messageId: "notified" } as never), false);
  assert.equal(await markChatCompletionNotifiedHandler(state.ctx, { messageId: "trigger" } as never), true);

  assert.deepEqual(state.patches.map((patch) => patch.id), ["trigger"]);
  assert.equal(typeof state.patches[0].patch.chatCompletionNotifiedAt, "number");
});

test("job status updates handle missing jobs, terminal timestamps, and optional message mirrors", async () => {
  const state = buildCtx({
    message_1: { _id: "message_1", status: "streaming" },
    job_1: { _id: "job_1", messageId: "message_1", status: "queued" },
  });

  await updateJobStatusHandler(state.ctx, {
    jobId: "missing_job",
    status: "completed",
    error: "late completion without a row",
  } as never);
  await updateJobStatusHandler(state.ctx, {
    jobId: "job_1",
    messageId: "message_1",
    status: "completed",
    openrouterGenerationId: "gen_1",
  } as never);

  assert.equal(state.patches[0].id, "missing_job");
  assert.equal(state.patches[0].patch.status, "completed");
  assert.equal(typeof state.patches[0].patch.completedAt, "number");
  assert.equal(state.patches[1].id, "job_1");
  assert.equal(state.patches[2].id, "message_1");
  assert.deepEqual(state.patches[2].patch, { openrouterGenerationId: "gen_1" });
});

test("video job and generated-media handlers persist lifecycle metadata", async () => {
  const state = buildCtx();

  const videoJobId = await createVideoJobHandler(state.ctx, {
    messageId: "message_1",
    chatId: "chat_1",
    userId: "user_1",
    openRouterJobId: "or_job_1",
    model: "video/model",
    prompt: "make a product clip",
    videoConfig: { aspectRatio: "16:9", duration: 8, generateAudio: true },
  } as never);
  await updateVideoJobStatusHandler(state.ctx, {
    videoJobId,
    status: "failed",
    error: "provider failed",
  } as never);
  await updateVideoJobPollHandler(state.ctx, {
    videoJobId,
    status: "in_progress",
    pollCount: 3,
  } as never);
  const mediaId = await insertGeneratedMediaHandler(state.ctx, {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    storageId: "storage_video",
    type: "video",
    mimeType: "video/mp4",
    sizeBytes: 1234,
    width: 1280,
    height: 720,
    durationSeconds: 8,
    model: "video/model",
    prompt: "make a product clip",
  } as never);

  assert.equal(videoJobId, "videoJobs_1");
  assert.equal(mediaId, "generatedMedia_2");
  assert.equal(state.inserts[0].value.pollCount, 0);
  assert.equal(state.patches[0].patch.error, "provider failed");
  assert.equal(state.patches[1].patch.pollCount, 3);
  assert.equal(state.inserts[1].value.durationSeconds, 8);
  assert.equal(state.inserts[1].value.referenceTrackingVersion, 1);
});

test("streaming message content updates patch explicit rows or create fallback rows", async () => {
  const state = buildCtx({
    message_1: { _id: "message_1", chatId: "chat_1", status: "streaming" },
    stream_1: {
      _id: "stream_1",
      table: "streamingMessages",
      messageId: "message_1",
      chatId: "chat_1",
      status: "streaming",
      content: "old",
      updatedAt: 1,
    },
    message_2: { _id: "message_2", chatId: "chat_1", status: "pending" },
  });

  await updateMessageContentHandler(state.ctx, {
    messageId: "message_1",
    streamingMessageId: "stream_1",
    content: "new content",
    status: "streaming",
  } as never);
  await updateMessageContentHandler(state.ctx, {
    messageId: "message_2",
    content: "fallback content",
    status: "streaming",
  } as never);

  assert.equal(state.patches[0].id, "stream_1");
  assert.equal(state.patches[0].patch.content, "new content");
  assert.equal(state.inserts[0].table, "streamingMessages");
  assert.equal(state.inserts[0].value.messageId, "message_2");
  assert.equal(state.inserts[0].value.content, "fallback content");
});

test("patchMessageAudioHandler replaces changed audio blobs and tolerates missing old blobs", async () => {
  const state = buildCtx({
    message_1: { _id: "message_1", audioStorageId: "audio_old" },
    message_2: { _id: "message_2", audioStorageId: "audio_throw" },
    message_3: { _id: "message_3", audioStorageId: "audio_same" },
  });

  await patchMessageAudioHandler(state.ctx, {
    messageId: "message_1",
    audioStorageId: "audio_new",
    audioDurationMs: 1_000,
    audioVoice: "alloy",
    audioTranscript: "hello",
    audioGeneratedAt: 123,
  } as never);
  await patchMessageAudioHandler(state.ctx, {
    messageId: "message_2",
    audioStorageId: "audio_new_2",
  } as never);
  await patchMessageAudioHandler(state.ctx, {
    messageId: "message_3",
    audioStorageId: "audio_same",
  } as never);

  assert.deepEqual(state.storageDeletes, ["audio_old", "audio_throw"]);
  assert.equal(state.patches[0].patch.audioStorageId, "audio_new");
  assert.equal(state.patches[0].patch.audioGenerating, undefined);
  assert.equal(state.patches[2].patch.audioStorageId, "audio_same");
});

test("job status updates protect terminal jobs and mirror terminal error metadata", async () => {
  const state = buildCtx({
    message_1: { _id: "message_1", status: "streaming" },
    message_2: { _id: "message_2", status: "streaming" },
    job_terminal: { _id: "job_terminal", messageId: "message_1", status: "completed" },
    job_mismatch: { _id: "job_mismatch", messageId: "message_1", status: "queued" },
    job_running: { _id: "job_running", messageId: "message_2", status: "streaming" },
  });

  await updateJobStatusHandler(state.ctx, {
    jobId: "job_terminal",
    messageId: "message_1",
    status: "streaming",
  } as never);
  assert.equal(state.patches.length, 0);

  await assert.rejects(
    updateJobStatusHandler(state.ctx, {
      jobId: "job_mismatch",
      messageId: "message_2",
      status: "failed",
    } as never),
    /messageId does not match/,
  );

  await updateJobStatusHandler(state.ctx, {
    jobId: "job_running",
    messageId: "message_2",
    status: "failed",
    startedAt: 111,
    error: "provider failed",
    terminalErrorCode: "provider_error",
  } as never);

  assert.equal(state.patches[0].id, "job_running");
  assert.equal(state.patches[0].patch.startedAt, 111);
  assert.equal(state.patches[0].patch.error, "provider failed");
  assert.equal(state.patches[0].patch.terminalErrorCode, "provider_error");
  assert.equal(typeof state.patches[0].patch.completedAt, "number");
  assert.deepEqual(state.patches[1], {
    id: "message_2",
    patch: { terminalErrorCode: "provider_error" },
  });
});
