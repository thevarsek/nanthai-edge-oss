import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { appendCurrentTurnAudioInput } from "../chat/audio_input_request";
import {
  getMessageAudioUrlHandler,
} from "../chat/audio_query_handlers";
import {
  requestAudioGenerationHandler,
} from "../chat/audio_public_handlers";
import {
  getAuthorizedChat,
  getAuthorizedMessage,
  withRefreshedAttachmentUrls,
} from "../chat/query_helpers";

test("query helpers enforce ownership and refresh attachment URLs", async () => {
  const dbRecords: Record<string, any> = {
    chat_1: { _id: "chat_1", userId: "user_1" },
    chat_2: { _id: "chat_2", userId: "user_2" },
    msg_1: { _id: "msg_1", chatId: "chat_1" },
    msg_2: { _id: "msg_2", chatId: "chat_2" },
  };
  const ctx = {
    db: {
      get: async (id: string) => dbRecords[id] ?? null,
    },
    storage: {
      getUrl: async (storageId: string) =>
        storageId === "file_1" ? "https://cdn.example/file_1" : null,
    },
  } as any;

  assert.equal((await getAuthorizedChat(ctx, "chat_1" as any, "user_1"))?._id, "chat_1");
  assert.equal(await getAuthorizedChat(ctx, "chat_2" as any, "user_1"), null);
  assert.equal((await getAuthorizedMessage(ctx, "msg_1" as any, "user_1"))?._id, "msg_1");
  assert.equal(await getAuthorizedMessage(ctx, "msg_2" as any, "user_1"), null);

  const refreshed = await withRefreshedAttachmentUrls(ctx, {
    _id: "msg_1",
    attachments: [
      { type: "document", storageId: "file_1", url: "stale" },
      { type: "document", url: "keep" },
    ],
  });
  assert.equal(refreshed.attachments?.[0]?.url, "https://cdn.example/file_1");
  assert.equal(refreshed.attachments?.[1]?.url, "keep");
});

test("appendCurrentTurnAudioInput appends audio payloads to the latest user message", async (t) => {
  t.after(() => mock.restoreAll());

  const fetchMock = mock.method(globalThis, "fetch", async () =>
    new Response(new Uint8Array([0, 1, 2]), { status: 200 }),
  );

  const messages = await appendCurrentTurnAudioInput(
    [
      { role: "assistant", content: "previous" },
      { role: "user", content: "transcribe this" },
    ] as any,
    {
      _id: "msg_user",
      content: "transcribe this",
      attachments: [
        { type: "audio", url: "https://audio.example/input.m4a", mimeType: "audio/mp4" },
      ],
    },
    true,
  );

  assert.equal(fetchMock.mock.callCount(), 1);
  const latest = messages[messages.length - 1] as any;
  assert.equal(Array.isArray(latest.content), true);
  assert.deepEqual(latest.content[0], { type: "text", text: "transcribe this" });
  assert.deepEqual(latest.content[1], {
    type: "input_audio",
    input_audio: {
      data: "AAEC",
      format: "m4a",
    },
  });
});

test("requestAudioGenerationHandler schedules audio generation once and short-circuits duplicates", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const scheduled: Record<string, unknown>[] = [];
  const chat = { _id: "chat_1", userId: "user_1" };
  const message = {
    _id: "msg_1",
    chatId: "chat_1",
    role: "assistant",
    content: "Narrate this",
    audioGenerating: false,
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "msg_1") return message;
        if (id === "chat_1") return chat;
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any;

  const first = await requestAudioGenerationHandler(ctx, { messageId: "msg_1" as any });

  const duplicateCtx = {
    ...ctx,
    db: {
      ...ctx.db,
      get: async (id: string) => {
        if (id === "msg_1") {
          return { ...message, audioGenerating: true };
        }
        if (id === "chat_1") return chat;
        return null;
      },
    },
  } as any;

  const duplicate = await requestAudioGenerationHandler(
    duplicateCtx,
    { messageId: "msg_1" as any },
  );

  assert.deepEqual(first, { scheduled: true });
  assert.deepEqual(duplicate, { scheduled: true, alreadyExists: true });
  assert.deepEqual(patches, [{ id: "msg_1", value: { audioGenerating: true } }]);
  assert.deepEqual(scheduled, [{ messageId: "msg_1" }]);
});

test("getMessageAudioUrlHandler requires auth and ownership before returning a URL", async () => {
  const baseCtx = {
    db: {
      get: async (id: string) => {
        if (id === "msg_1") {
          return {
            _id: "msg_1",
            chatId: "chat_1",
            audioStorageId: "audio_1",
          };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        return null;
      },
    },
    storage: {
      getUrl: async () => "https://cdn.example/audio_1.wav",
    },
  };

  const anonymous = await getMessageAudioUrlHandler(
    {
      ...baseCtx,
      auth: { getUserIdentity: async () => null },
    } as any,
    { messageId: "msg_1" as any },
  );
  const authorized = await getMessageAudioUrlHandler(
    {
      ...baseCtx,
      auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    } as any,
    { messageId: "msg_1" as any },
  );

  assert.equal(anonymous, null);
  assert.equal(authorized, "https://cdn.example/audio_1.wav");
});
