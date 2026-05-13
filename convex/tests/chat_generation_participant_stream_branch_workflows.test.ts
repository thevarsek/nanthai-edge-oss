import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { generateForParticipant } from "../chat/actions_run_generation_participant";

function makeArgs(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1",
    userId: "user_1",
    userMessageId: "msg_user",
    assistantMessageIds: ["msg_assistant"],
    generationJobIds: ["job_1"],
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    enabledIntegrations: [],
    ...overrides,
  } as any;
}

function makeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    messageId: "msg_assistant",
    jobId: "job_1",
    modelId: "model_1",
    temperature: 0.7,
    maxTokens: null,
    includeReasoning: null,
    reasoningEffort: null,
    personaId: null,
    systemPrompt: null,
    ...overrides,
  } as any;
}

function makeCtx(options: {
  cancelAfterChecks?: number;
  userPrefs?: Record<string, unknown> | null;
} = {}) {
  const mutations: Array<{ args: Record<string, unknown> }> = [];
  let cancelChecks = 0;
  return {
    mutations,
    ctx: {
      runQuery: async (_ref: unknown, queryArgs: Record<string, unknown>) => {
        if ("jobId" in queryArgs) {
          cancelChecks += 1;
          return options.cancelAfterChecks !== undefined
            && cancelChecks > options.cancelAfterChecks;
        }
        if ("userId" in queryArgs && !("chatId" in queryArgs)) {
          return options.userPrefs ?? null;
        }
        return null;
      },
      runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
        mutations.push({ args: mutationArgs });
        return null;
      },
      scheduler: {
        runAfter: async () => "scheduled_1",
      },
      storage: {
        get: async () => null,
        store: async () => "stored_image_1",
        getUrl: async () => "https://files.example/stored_image_1.png",
      },
    } as any,
  };
}

function streamResponse(events: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      ...events.map((event) => `data: ${JSON.stringify(event)}`),
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

const modelCaps = new Map([[
  "model_1",
  {
    provider: "openai",
    supportedParameters: [],
    contextLength: 128_000,
    hasZdrEndpoint: true,
  } as any,
]]);

async function runParticipant(overrides: Record<string, unknown> = {}) {
  const state = makeCtx(overrides.ctxOptions as any);
  const result = await generateForParticipant({
    ctx: state.ctx,
    args: makeArgs(),
    participant: makeParticipant(),
    allMessages: [{ _id: "msg_user", role: "user", content: "Hello" }],
    memoryContext: undefined,
    modelCapabilities: modelCaps,
    isPro: true,
    runtimeProfile: "mobileBasic",
    apiKey: "key",
    actionStartTime: Date.now(),
    requestMessagesOverride: [{ role: "user", content: "Hello" }],
    ...overrides,
  } as any);
  return { result, mutations: state.mutations };
}

test("generateForParticipant finalizes reasoning-only streams as a visible response", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    {
      id: "gen_reasoning",
      choices: [{
        delta: {
          reasoning_details: [{ type: "reasoning.text", text: "  working it out  " }],
        },
      }],
    },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const { result, mutations } = await runParticipant();

  assert.equal(result.failed, false);
  const finalize = mutations.find((entry) => entry.args.status === "completed")?.args;
  assert.equal(finalize?.content, "Model returned reasoning only.");
  assert.equal(finalize?.reasoning, "working it out");
  assert.equal(finalize?.openrouterGenerationId, "gen_reasoning");
});

test("generateForParticipant persists inline audio when the Node persistence hook is available", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    {
      id: "gen_audio",
      choices: [{
        delta: {
          content: "Audio ready.",
          audio: { data: "QUJD", transcript: "abc" },
        },
      }],
    },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const { mutations } = await runParticipant({
    persistInlineAudio: async (audioBase64: string) => {
      assert.equal(audioBase64, "QUJD");
      return {
        audioStorageId: "audio_storage_1",
        audioDurationMs: 1234,
        audioGeneratedAt: 456,
      };
    },
  });

  const finalize = mutations.find((entry) => entry.args.status === "completed")?.args;
  assert.equal(finalize?.content, "Audio ready.");
  assert.equal(finalize?.audioStorageId, "audio_storage_1");
  assert.equal(finalize?.audioDurationMs, 1234);
  assert.equal(finalize?.audioGeneratedAt, 456);
});

test("generateForParticipant cancels after periodic stream cancellation checks", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    ...Array.from({ length: 10 }, (_, index) => ({
      choices: [{ delta: { content: `chunk-${index} ` } }],
    })),
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const { result, mutations } = await runParticipant({
    ctxOptions: { cancelAfterChecks: 1 },
  });

  assert.equal(result.cancelled, true);
  const finalize = mutations.find((entry) => entry.args.status === "cancelled")?.args;
  assert.equal(finalize?.content, "[Generation cancelled]");
  assert.equal(finalize?.terminalErrorCode, undefined);
});

test("generateForParticipant fails inline audio when persistence is unavailable", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    {
      id: "gen_audio_missing_hook",
      choices: [{
        delta: {
          content: "Audio ready.",
          audio: { data: "QUJD", transcript: "abc" },
        },
      }],
    },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const { result, mutations } = await runParticipant();

  assert.equal(result.failed, true);
  const finalize = mutations.find((entry) => entry.args.status === "failed")?.args;
  assert.match(String(finalize?.content), /Inline audio output requires Node-backed persistence/);
});

test("generateForParticipant stores inline image-only streams as generated media", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => streamResponse([
    {
      id: "gen_image",
      choices: [{
        delta: {
          content: `data:image/png;base64,${"A".repeat(80)}`,
        },
      }],
    },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const { result, mutations } = await runParticipant();

  assert.equal(result.failed, false);
  assert.ok(mutations.some((entry) =>
    entry.args.storageId === "stored_image_1"
    && entry.args.type === "image"
    && entry.args.mimeType === "image/png"
  ));
  const finalize = mutations.find((entry) => entry.args.status === "completed")?.args;
  assert.equal(finalize?.content, "[Generated image]");
  assert.deepEqual(finalize?.imageUrls, ["https://files.example/stored_image_1.png"]);
});
