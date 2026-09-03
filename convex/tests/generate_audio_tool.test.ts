import assert from "node:assert/strict";
import test from "node:test";

import { encryptSecret, userApiKeySecretContext } from "../lib/secret_crypto";
import { generateSpeech } from "../tools/generate_audio";

test("generate_speech records provider usage before local artifact persistence fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalEncryptionKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "generate-speech-usage-test-key";
  const encryptedApiKey = await encryptSecret(
    "openrouter-test-key",
    userApiKeySecretContext("user_1"),
    () => new Uint8Array(12).fill(9),
  );
  let queryCount = 0;
  const scheduled: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const cleanupRequests: string[][] = [];
  let publicationAttempts = 0;

  try {
    globalThis.fetch = (async () => new Response(
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
      {
        status: 200,
        headers: { "X-Generation-Id": "speech_generation_1" },
      },
    )) as typeof fetch;

    await assert.rejects(() => generateSpeech.execute({
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      toolCallId: "tool_call_1",
      operationIdempotencyKey: "job_1:generate_speech:operation_1",
      ctx: {
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) {
            return {
              speechModelId: "deepgram/aura-2",
              zdrEnabled: false,
              speechConfig: {},
            };
          }
          if (queryCount === 2) {
            return {
              hasSpeechGeneration: true,
              supportedVoices: ["aura-2-thalia-en"],
              speechCapabilities: {
                outputFormats: ["mp3"],
                supportsSpeed: false,
                supportsInstructions: false,
                supportsStyle: false,
              },
            };
          }
          if (queryCount === 3) return encryptedApiKey;
          return false;
        },
        runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
          if (Array.isArray(args.storageIds)) {
            cleanupRequests.push(args.storageIds as string[]);
            return null;
          }
          publicationAttempts += 1;
          throw new Error("artifact persistence failed");
        },
        scheduler: {
          runAfter: async (_delay: number, _reference: unknown, args: Record<string, unknown>) => {
            scheduled.push(args);
          },
        },
        storage: {
          store: async () => "storage_failed",
          getUrl: async () => "https://files.example/speech.mp3",
          delete: async (storageId: string) => { deleted.push(storageId); },
        },
      },
    } as any, { text: "Hello" }), /artifact persistence failed/);

    assert.equal(scheduled[0]?.generationId, "speech_generation_1");
    assert.equal(publicationAttempts, 2);
    assert.deepEqual(cleanupRequests, [["storage_failed"]]);
    assert.deepEqual(deleted, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEncryptionKey === undefined) {
      delete process.env.CONVEX_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.CONVEX_SECRET_ENCRYPTION_KEY = originalEncryptionKey;
    }
  }
});

test("generate_speech recovers when publication commits but its response is lost", async () => {
  const originalFetch = globalThis.fetch;
  const originalEncryptionKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "generate-speech-publication-retry-test-key";
  const encryptedApiKey = await encryptSecret(
    "openrouter-test-key",
    userApiKeySecretContext("user_1"),
    () => new Uint8Array(12).fill(5),
  );
  let queryCount = 0;
  let publicationAttempts = 0;
  const cleanupRequests: string[][] = [];
  const deleted: string[] = [];

  try {
    globalThis.fetch = (async () => new Response(
      new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]),
      { status: 200 },
    )) as typeof fetch;

    const result = await generateSpeech.execute({
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      toolCallId: "tool_call_1",
      operationIdempotencyKey: "job_1:generate_speech:operation_1",
      ctx: {
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) {
            return {
              speechModelId: "deepgram/aura-2",
              zdrEnabled: false,
              speechConfig: {},
            };
          }
          if (queryCount === 2) {
            return {
              hasSpeechGeneration: true,
              supportedVoices: ["aura-2-thalia-en"],
              speechCapabilities: {
                outputFormats: ["mp3"],
                supportsSpeed: false,
                supportsInstructions: false,
                supportsStyle: false,
              },
            };
          }
          if (queryCount === 3) return encryptedApiKey;
          return false;
        },
        runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
          if (Array.isArray(args.storageIds)) {
            cleanupRequests.push(args.storageIds as string[]);
            return null;
          }
          publicationAttempts += 1;
          if (publicationAttempts === 1) throw new Error("response lost after commit");
          const data = JSON.parse(String(args.operationResultDataJson)) as Record<string, unknown>;
          return {
            generatedFileId: "generated_file_1",
            resultJson: JSON.stringify({
              success: true,
              data: { ...data, generatedFileId: "generated_file_1" },
            }),
          };
        },
        storage: {
          store: async () => "storage_committed",
          getUrl: async () => "https://files.example/speech.mp3",
          delete: async (storageId: string) => { deleted.push(storageId); },
        },
      },
    } as any, { text: "Hello" });

    assert.equal(result.success, true);
    assert.equal((result.data as Record<string, unknown>).generatedFileId, "generated_file_1");
    assert.equal(publicationAttempts, 2);
    assert.deepEqual(cleanupRequests, []);
    assert.deepEqual(deleted, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEncryptionKey === undefined) {
      delete process.env.CONVEX_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.CONVEX_SECRET_ENCRYPTION_KEY = originalEncryptionKey;
    }
  }
});

test("generate_speech does not reuse a default model voice for an explicit model override", async () => {
  const originalEncryptionKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "generate-speech-model-override-test-key";
  const encryptedApiKey = await encryptSecret(
    "openrouter-test-key",
    userApiKeySecretContext("user_1"),
    () => new Uint8Array(12).fill(7),
  );
  let queryCount = 0;
  try {
    const result = await generateSpeech.execute({
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      toolCallId: "tool_call_1",
      operationIdempotencyKey: "job_1:generate_speech:operation_1",
      ctx: {
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) {
            return {
              speechModelId: "provider/default-speech",
              zdrEnabled: false,
              speechConfig: { voice: "voice-for-default-model" },
            };
          }
          if (queryCount === 2) {
            return {
              hasSpeechGeneration: true,
              supportedVoices: [],
              speechCapabilities: {
                outputFormats: ["mp3"],
                supportsSpeed: false,
                supportsInstructions: false,
                supportsStyle: false,
              },
            };
          }
          return encryptedApiKey;
        },
      },
    } as any, {
      text: "Hello",
      model_id: "provider/override-speech",
    });

    assert.equal(result.success, false);
    assert.match(String(result.error), /provider voice ID is required/i);
    assert.equal(queryCount, 3);
  } finally {
    if (originalEncryptionKey === undefined) {
      delete process.env.CONVEX_SECRET_ENCRYPTION_KEY;
    } else {
      process.env.CONVEX_SECRET_ENCRYPTION_KEY = originalEncryptionKey;
    }
  }
});
