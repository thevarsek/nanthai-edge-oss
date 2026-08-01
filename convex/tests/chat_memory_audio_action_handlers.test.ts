import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import {
  extractMemoriesHandler,
} from "../chat/actions_extract_memories_handler";
import {
  generateAudioForMessageHandler,
  previewVoiceHandler,
} from "../chat/audio_actions";
import { MODEL_IDS } from "../lib/model_constants";

const enqueueMemoryEmbeddingRef = getFunctionName(
  internal.execution.workload_queues.enqueueMemoryEmbedding,
);
const isChatWritableRef = getFunctionName(
  internal.chat.post_process_guard.isChatWritable,
);

function makeSchedulerCapture(scheduled: Array<Record<string, unknown>>) {
  return {
    runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
      scheduled.push(args);
      return `scheduled_${scheduled.length}`;
    },
    runAt: async () => "unused",
  };
}

function analyticsForOperation(
  scheduled: Array<Record<string, unknown>>,
  operation: string,
) {
  return scheduled.filter((entry) =>
    (entry.properties as Record<string, unknown> | undefined)?.operation === operation
  );
}

function textResponse(status: number, text: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
  } as any;
}

function sseResponseFromContent(
  content: string,
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost?: number },
  generationId = "gen_1",
) {
  return textResponse(
    200,
    [
      `data: ${JSON.stringify({ id: generationId, choices: [{ delta: { content } }] })}`,
      `data: ${JSON.stringify({ choices: [{ finish_reason: "stop" }], usage })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  );
}

function sseResponseWithAudio(
  audioBase64: string,
  transcript: string,
  generationId = "audio_gen_1",
) {
  return textResponse(
    200,
    [
      `data: ${JSON.stringify({
        id: generationId,
        choices: [{
          delta: {
            audio: { data: audioBase64, transcript },
          },
        }],
      })}`,
      `data: ${JSON.stringify({
        choices: [{ finish_reason: "stop" }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  );
}

test("extractMemoriesHandler reinforces duplicates, supersedes conflicts, and stores embeddings for new memories", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(globalThis, "fetch", async () =>
    sseResponseFromContent(
      JSON.stringify([
        {
          content: "User prefers concise answers",
          evidenceQuote: "I prefer concise answers",
          evidenceKind: "explicitPreference",
          durability: "durable",
          category: "preferences",
          memoryType: "responsePreference",
          importanceScore: 0.95,
          confidenceScore: 0.9,
        },
        {
          content: "User lives in Berlin",
          evidenceQuote: "I moved to Berlin",
          evidenceKind: "explicitFact",
          durability: "durable",
          category: "identity",
          memoryType: "profile",
          importanceScore: 0.91,
          confidenceScore: 0.88,
        },
        {
          content: "User works as a product engineer",
          evidenceQuote: "Assistant responded: Noted",
          evidenceKind: "explicitFact",
          durability: "durable",
          category: "work",
          memoryType: "workContext",
          importanceScore: 0.8,
          confidenceScore: 0.78,
        },
      ]),
      { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19, cost: 0.03 },
      "memory_gen_1",
    )) as any;

  const getUserMemoriesRef = getFunctionName(internal.chat.queries.getUserMemories);
  const prefsRef = getFunctionName(internal.chat.queries.getUserPreferences);
  const getUserApiKeyRef = getFunctionName(internal.scheduledJobs.queries.getEncryptedUserApiKey);
  const reinforceRef = getFunctionName(internal.chat.mutations.reinforceMemory);
  const supersedeRef = getFunctionName(internal.chat.mutations.supersedeMemory);
  const createRef = getFunctionName(internal.chat.mutations.createMemory);
  const mutationCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  const scheduled: Record<string, unknown>[] = [];
  const existingMemories = [
    {
      _id: "memory_dup",
      content: "User prefers concise answers.",
      category: "preferences",
      memoryType: "responsePreference",
      retrievalMode: "alwaysOn",
      importanceScore: 0.92,
      confidenceScore: 0.9,
      isPending: false,
      isSuperseded: false,
      createdAt: 1,
      updatedAt: 1,
      isPinned: false,
      accessCount: 0,
      sourceType: "chat",
    },
    {
      _id: "memory_old_location",
      content: "User lives in London.",
      category: "identity",
      memoryType: "profile",
      retrievalMode: "alwaysOn",
      importanceScore: 0.88,
      confidenceScore: 0.84,
      isPending: false,
      isSuperseded: false,
      createdAt: 1,
      updatedAt: 1,
      isPinned: false,
      accessCount: 0,
      sourceType: "chat",
    },
  ];
  let nextMemoryId = 1;

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === isChatWritableRef) return true;
      if (name === getUserMemoriesRef) return existingMemories;
      if (name === prefsRef) return {};
      if (name === getUserApiKeyRef) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as any);
      mutationCalls.push({ ref: name, args });
      if (name === createRef) {
        return `memory_new_${nextMemoryId++}`;
      }
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any, {
    chatId: "chat_1" as any,
    userMessageContent: "Please remember that I prefer concise answers and that I moved to Berlin.",
    userMessageId: "msg_user_1" as any,
    assistantMessageId: "msg_assistant_1" as any,
    assistantContent: "Noted.",
    userId: "user_1",
  });

  assert.equal(mutationCalls.some((call) => call.ref === reinforceRef), true);
  assert.equal(
    mutationCalls.some(
      (call) => call.ref === supersedeRef && call.args.memoryId === "memory_old_location",
    ),
    true,
  );
  const created = mutationCalls.filter((call) => call.ref === createRef);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.args.supersedesMemoryId, "memory_old_location");
  assert.deepEqual(
    scheduled.filter((entry) => entry.source === "memory_extraction").map((entry) => entry.source),
    ["memory_extraction"],
  );
  assert.deepEqual(
    mutationCalls.find((call) => call.ref === enqueueMemoryEmbeddingRef)?.args,
    { memoryId: "memory_new_1", content: "User lives in Berlin." },
  );
  const memoryAnalytics = analyticsForOperation(scheduled, "memory_extraction");
  assert.deepEqual(
    memoryAnalytics.map((entry) => entry.event),
    ["backend_ai_operation_started", "backend_ai_operation_completed"],
  );
  const completed = memoryAnalytics.find((entry) => entry.event === "backend_ai_operation_completed");
  assert.equal((completed?.properties as Record<string, unknown> | undefined)?.created_memory_count, 1);
  assert.equal((completed?.properties as Record<string, unknown> | undefined)?.reinforced_memory_count, 1);
  assert.equal((completed?.properties as Record<string, unknown> | undefined)?.superseded_memory_count, 1);
  assert.equal((completed?.properties as Record<string, unknown> | undefined)?.total_tokens, 19);
});

test("extractMemoriesHandler skips privacy-sensitive and low-score candidates", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(globalThis, "fetch", async () =>
    sseResponseFromContent(
      JSON.stringify([
        {
          content: "User email: dino@example.com",
          evidenceQuote: "my email",
          evidenceKind: "explicitFact",
          durability: "durable",
          category: "identity",
          memoryType: "profile",
          importanceScore: 0.9,
          confidenceScore: 0.9,
        },
        {
          content: "User prefers direct answers",
          evidenceQuote: "Keep my email out of memory",
          evidenceKind: "explicitPreference",
          durability: "durable",
          category: "preferences",
          memoryType: "responsePreference",
          importanceScore: 0.49,
          confidenceScore: 0.9,
        },
        {
          content: "User works as a platform engineer",
          evidenceQuote: "Keep my email out of memory",
          evidenceKind: "explicitFact",
          durability: "durable",
          category: "work",
          memoryType: "workContext",
          importanceScore: 0.8,
          confidenceScore: 0.4,
        },
      ]),
      { prompt_tokens: 6, completion_tokens: 4, total_tokens: 10 },
      "memory_gen_2",
    )) as any;

  const getUserMemoriesRef = getFunctionName(internal.chat.queries.getUserMemories);
  const prefsRef = getFunctionName(internal.chat.queries.getUserPreferences);
  const getUserApiKeyRef = getFunctionName(internal.scheduledJobs.queries.getEncryptedUserApiKey);
  const createRef = getFunctionName(internal.chat.mutations.createMemory);
  const mutationCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  const scheduled: Record<string, unknown>[] = [];

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === isChatWritableRef) return true;
      if (name === getUserMemoriesRef) return [];
      if (name === prefsRef) return {};
      if (name === getUserApiKeyRef) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      mutationCalls.push({ ref: getFunctionName(ref as any), args });
      return "memory_unused";
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any, {
    chatId: "chat_1" as any,
    userMessageContent: "Keep my email out of memory.",
    userMessageId: "msg_user_2" as any,
    assistantMessageId: "msg_assistant_2" as any,
    assistantContent: "Understood.",
    userId: "user_1",
  });

  assert.equal(mutationCalls.some((call) => call.ref === createRef), false);
  assert.deepEqual(
    scheduled.filter((entry) => entry.source).map((entry) => entry.source),
    ["memory_extraction"],
  );
  const memoryAnalytics = analyticsForOperation(scheduled, "memory_extraction");
  assert.deepEqual(
    memoryAnalytics.map((entry) => entry.event),
    ["backend_ai_operation_started", "backend_ai_operation_completed"],
  );
  const completed = memoryAnalytics.find((entry) => entry.event === "backend_ai_operation_completed");
  assert.equal((completed?.properties as Record<string, unknown> | undefined)?.created_memory_count, 0);
  assert.equal((completed?.properties as Record<string, unknown> | undefined)?.skipped_candidate_count, 3);
});

test("extractMemoriesHandler uses ZDR-safe default model and provider when ZDR is enabled", async (t) => {
  t.after(() => mock.restoreAll());

  let requestBody: Record<string, unknown> = {};
  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return sseResponseFromContent("[]");
  }) as any;

  const getUserMemoriesRef = getFunctionName(internal.chat.queries.getUserMemories);
  const prefsRef = getFunctionName(internal.chat.queries.getUserPreferences);
  const getUserApiKeyRef = getFunctionName(internal.scheduledJobs.queries.getEncryptedUserApiKey);

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === isChatWritableRef) return true;
      if (name === getUserMemoriesRef) return [];
      if (name === prefsRef) {
        return {
          zdrEnabled: true,
          memoryExtractionModelId: "openai/non-zdr-memory",
        };
      }
      if (name === getUserApiKeyRef) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async () => null,
    scheduler: { runAfter: async () => undefined },
  } as any, {
    chatId: "chat_1" as any,
    userMessageContent: "Remember that I prefer concise answers.",
    userMessageId: "msg_user_zdr" as any,
    assistantMessageId: "msg_assistant_zdr" as any,
    assistantContent: "Noted.",
    userId: "user_1",
    extractionModel: "openai/non-zdr-memory",
  });

  assert.equal(requestBody.model, MODEL_IDS.memoryExtraction);
  assert.deepEqual(requestBody.provider, { sort: "latency", zdr: true });
});

test("generateAudioForMessageHandler reuses existing audio without regenerating", async (t) => {
  t.after(() => mock.restoreAll());

  const fetchMock = mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not run");
  });

  const result = await generateAudioForMessageHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === getFunctionName(internal.chat.queries.getMessageInternal)) {
        return {
          _id: "msg_audio_1",
          role: "assistant",
          chatId: "chat_1",
          content: "Narrate this.",
          audioStorageId: "storage_existing",
          audioDurationMs: 1234,
          audioVoice: "verse",
          audioTranscript: "Narrate this.",
        };
      }
      throw new Error(`unexpected query ${name}`);
    },
  } as any, {
    messageId: "msg_audio_1" as any,
  });

  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(result, {
    audioStorageId: "storage_existing",
    audioDurationMs: 1234,
    audioVoice: "verse",
    audioTranscript: "Narrate this.",
  });
});

test("generateAudioForMessageHandler stores synthesized audio and previewVoiceHandler uses the default voice", async (t) => {
  t.after(() => mock.restoreAll());

  const requestBodies: any[] = [];
  const audioScheduled: Array<Record<string, unknown>> = [];
  const previewScheduled: Array<Record<string, unknown>> = [];
  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return sseResponseWithAudio(Buffer.alloc(480, 1).toString("base64"), "Narrate this.");
  });

  const messageRef = getFunctionName(internal.chat.queries.getMessageInternal);
  const chatRef = getFunctionName(internal.chat.queries.getChatInternal);
  const prefsRef = getFunctionName(internal.chat.queries.getUserPreferences);
  const keyRef = getFunctionName(internal.scheduledJobs.queries.getEncryptedUserApiKey);
  const patchAudioRef = getFunctionName(internal.chat.mutations.patchMessageAudio);
  const mutations: Array<{ ref: string; args: Record<string, unknown> }> = [];

  const audioResult = await generateAudioForMessageHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === messageRef) {
        return {
          _id: "msg_audio_2",
          role: "assistant",
          chatId: "chat_1",
          content: "Narrate this.",
        };
      }
      if (name === chatRef) return { _id: "chat_1", userId: "user_1" };
      if (name === prefsRef) return { preferredVoice: "alloy" };
      if (name === keyRef) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      mutations.push({ ref: getFunctionName(ref as any), args });
      return null;
    },
    storage: {
      store: async (blob: Blob) => {
        assert.equal(blob.type, "audio/wav");
        assert.equal((await blob.arrayBuffer()).byteLength > 44, true);
        return "storage_new";
      },
    },
    scheduler: makeSchedulerCapture(audioScheduled),
  } as any, {
    messageId: "msg_audio_2" as any,
  });

  const previewResult = await previewVoiceHandler({
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    runQuery: async () => "sk-test",
    scheduler: makeSchedulerCapture(previewScheduled),
  } as any, {
    voice: "   ",
  });

  assert.equal(audioResult.audioStorageId, "storage_new");
  assert.equal(audioResult.audioVoice, "alloy");
  assert.equal(audioResult.audioDurationMs > 0, true);
  assert.equal(mutations.some((call) => call.ref === patchAudioRef), true);
  assert.equal(requestBodies[0].audio.voice, "alloy");
  assert.equal(requestBodies[1].audio.voice, "nova");
  assert.equal(previewResult.mimeType, "audio/wav");
  assert.equal(previewResult.audioBase64.length > 0, true);
  const audioAnalytics = analyticsForOperation(audioScheduled, "audio_generation");
  assert.deepEqual(
    audioAnalytics.map((entry) => entry.event),
    ["backend_ai_operation_started", "backend_ai_operation_completed"],
  );
  assert.equal((audioAnalytics[0]?.properties as Record<string, unknown>).source, "message_audio");
  assert.equal((audioAnalytics[1]?.properties as Record<string, unknown>).audio_duration_ms, 10);
  assert.equal((audioAnalytics[1]?.properties as Record<string, unknown>).storage_persisted, true);
  const previewAnalytics = analyticsForOperation(previewScheduled, "audio_preview");
  assert.deepEqual(
    previewAnalytics.map((entry) => entry.event),
    ["backend_ai_operation_started", "backend_ai_operation_completed"],
  );
  assert.equal((previewAnalytics[0]?.properties as Record<string, unknown>).source, "settings_voice_preview");
});

test("generateAudioForMessageHandler requires a ZDR-capable audio model under ZDR", async (t) => {
  t.after(() => mock.restoreAll());

  const requestBodies: any[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  mock.method(globalThis, "fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return sseResponseWithAudio(Buffer.alloc(480, 1).toString("base64"), "Narrate this.");
  });

  const messageRef = getFunctionName(internal.chat.queries.getMessageInternal);
  const chatRef = getFunctionName(internal.chat.queries.getChatInternal);
  const prefsRef = getFunctionName(internal.chat.queries.getUserPreferences);
  const keyRef = getFunctionName(internal.scheduledJobs.queries.getEncryptedUserApiKey);
  const capsRef = getFunctionName(internal.chat.queries.getModelCapabilities);

  await generateAudioForMessageHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === messageRef) {
        return {
          _id: "msg_audio_zdr",
          role: "assistant",
          chatId: "chat_1",
          content: "Narrate this.",
        };
      }
      if (name === chatRef) return { _id: "chat_1", userId: "user_1" };
      if (name === prefsRef) return { zdrEnabled: true, preferredVoice: "alloy" };
      if (name === keyRef) return "sk-test";
      if (name === capsRef) return { hasZdrEndpoint: true };
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async () => null,
    storage: {
      store: async () => "storage_zdr",
    },
    scheduler: makeSchedulerCapture(scheduled),
  } as any, {
    messageId: "msg_audio_zdr" as any,
  });

  assert.deepEqual(requestBodies[0].provider, { sort: "latency", zdr: true });
  const started = analyticsForOperation(scheduled, "audio_generation")
    .find((entry) => entry.event === "backend_ai_operation_started");
  assert.equal((started?.properties as Record<string, unknown> | undefined)?.zdr_required, true);
});

test("generateAudioForMessageHandler clears in-progress flags when synthesis fails", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(globalThis, "fetch", async () =>
    sseResponseFromContent("No audio payload", { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })) as any;

  const clearRef = getFunctionName(internal.chat.mutations.clearAudioGenerating);
  const mutationCalls: Array<{ ref: string; args: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await assert.rejects(
    () =>
      generateAudioForMessageHandler({
        runQuery: async (ref: unknown) => {
          const name = getFunctionName(ref as any);
          if (name === getFunctionName(internal.chat.queries.getMessageInternal)) {
            return {
              _id: "msg_audio_3",
              role: "assistant",
              chatId: "chat_1",
              content: "Narrate this.",
            };
          }
          if (name === getFunctionName(internal.chat.queries.getChatInternal)) {
            return { _id: "chat_1", userId: "user_1" };
          }
          if (
            name === getFunctionName(internal.chat.queries.getUserPreferences) ||
            name === getFunctionName(internal.scheduledJobs.queries.getEncryptedUserApiKey)
          ) {
            return name.endsWith("getEncryptedUserApiKey") ? "sk-test" : null;
          }
          throw new Error(`unexpected query ${name}`);
        },
        runMutation: async (ref: unknown, args: Record<string, unknown>) => {
          mutationCalls.push({ ref: getFunctionName(ref as any), args });
          return null;
        },
        storage: {
          store: async () => {
            throw new Error("store should not run");
          },
        },
        scheduler: makeSchedulerCapture(scheduled),
      } as any, {
        messageId: "msg_audio_3" as any,
      }),
    /no audio payload/i,
  );

  assert.equal(mutationCalls.some((call) => call.ref === clearRef), true);
  const failed = analyticsForOperation(scheduled, "audio_generation")
    .find((entry) => entry.event === "backend_ai_operation_failed");
  assert.equal((failed?.properties as Record<string, unknown> | undefined)?.error_label, "internal_error");
});

test("generateAudioForMessageHandler rejects invalid messages and missing chats", async () => {
  await assert.rejects(
    () =>
      generateAudioForMessageHandler({
        runQuery: async () => ({
          _id: "msg_user",
          role: "user",
          chatId: "chat_1",
          content: "hello",
        }),
      } as any, {
        messageId: "msg_user" as any,
      }),
    /Only assistant messages/,
  );

  await assert.rejects(
    () =>
      generateAudioForMessageHandler({
        runQuery: async (ref: unknown) => {
          const name = getFunctionName(ref as any);
          if (name === getFunctionName(internal.chat.queries.getMessageInternal)) {
            return {
              _id: "msg_audio_4",
              role: "assistant",
              chatId: "chat_missing",
              content: "Narrate this.",
            };
          }
          if (name === getFunctionName(internal.chat.queries.getChatInternal)) {
            return null;
          }
          throw new Error(`unexpected query ${name}`);
        },
      } as any, {
        messageId: "msg_audio_4" as any,
      }),
    /Chat not found/,
  );

  await assert.rejects(
    () =>
      generateAudioForMessageHandler({
        runQuery: async () => ({
          _id: "msg_audio_5",
          role: "assistant",
          chatId: "chat_1",
          content: "   ",
        }),
      } as any, {
        messageId: "msg_audio_5" as any,
      }),
    /no content to voice/i,
  );
});

test("previewVoiceHandler rejects missing API keys", async () => {
  await assert.rejects(
    () =>
      previewVoiceHandler({
        auth: {
          getUserIdentity: async () => ({ subject: "user_1" }),
        },
        runQuery: async () => null,
      } as any, {
        voice: "alloy",
      }),
    /MISSING_API_KEY/,
  );
});
