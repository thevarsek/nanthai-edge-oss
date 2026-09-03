import assert from "node:assert/strict";
import test from "node:test";

import { encryptSecret, userApiKeySecretContext } from "../lib/secret_crypto";
import { generateImage } from "../tools/generate_image";

test("generate_image publishes an image received before the provider body fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalEncryptionKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "generate-image-test-key";
  const encryptedApiKey = await encryptSecret(
    "openrouter-test-key",
    userApiKeySecretContext("user_1"),
    () => new Uint8Array(12).fill(7),
  );
  let queryCount = 0;
  let insertedMedia: Array<Record<string, unknown>> | undefined;
  const deleted: string[] = [];

  try {
    let pullCount = 0;
    globalThis.fetch = (async () => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode(
            '{"data":[{"b64_json":"AAEC","media_type":"image/png"},',
          ));
          return;
        }
        controller.error(new Error("upstream body disconnected"));
      },
    }), { status: 200 })) as typeof fetch;

    const result = await generateImage.execute({
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      toolCallId: "tool_call_1",
      operationIdempotencyKey: "job_1:generate_image:operation_1",
      ctx: {
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) {
            return {
              imageModelId: "openai/gpt-image-2",
              zdrEnabled: false,
              imageConfig: {},
            };
          }
          if (queryCount === 2) {
            return {
              hasImageGeneration: true,
              imageCapabilities: { supportedParameters: {} },
            };
          }
          if (queryCount === 3) return encryptedApiKey;
          return false;
        },
        runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
          if (Array.isArray(args.media)) {
            insertedMedia = args.media as Array<Record<string, unknown>>;
          }
          return [];
        },
        storage: {
          store: async () => "storage_partial",
          getUrl: async () => "https://files.example/partial.png",
          delete: async (storageId: string) => { deleted.push(storageId); },
        },
      },
    } as any, { prompt: "A detailed illustration" });

    assert.equal(result.success, true);
    assert.equal((result.data as any).generatedCount, 1);
    assert.equal(insertedMedia?.[0]?.storageId, "storage_partial");
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

test("generate_image records provider usage before local artifact persistence fails", async () => {
  const originalFetch = globalThis.fetch;
  const originalEncryptionKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "generate-image-usage-test-key";
  const encryptedApiKey = await encryptSecret(
    "openrouter-test-key",
    userApiKeySecretContext("user_1"),
    () => new Uint8Array(12).fill(8),
  );
  let queryCount = 0;
  const scheduled: Array<Record<string, unknown>> = [];
  const deleted: string[] = [];
  const cleanupRequests: string[][] = [];
  let publicationAttempts = 0;

  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "X-Generation-Id": "image_generation_1",
      },
    })) as typeof fetch;

    await assert.rejects(() => generateImage.execute({
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      toolCallId: "tool_call_1",
      operationIdempotencyKey: "job_1:generate_image:operation_1",
      ctx: {
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) {
            return {
              imageModelId: "openai/gpt-image-2",
              zdrEnabled: false,
              imageConfig: {},
            };
          }
          if (queryCount === 2) {
            return {
              hasImageGeneration: true,
              imageCapabilities: { supportedParameters: {} },
            };
          }
          if (queryCount === 3) return encryptedApiKey;
          return false;
        },
        runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
          if (Array.isArray(args.media)) {
            publicationAttempts += 1;
            throw new Error("artifact persistence failed");
          }
          if (Array.isArray(args.storageIds)) {
            cleanupRequests.push(args.storageIds as string[]);
          }
        },
        scheduler: {
          runAfter: async (_delay: number, _reference: unknown, args: Record<string, unknown>) => {
            scheduled.push(args);
          },
        },
        storage: {
          store: async () => "storage_failed",
          getUrl: async () => "https://files.example/generated.png",
          delete: async (storageId: string) => { deleted.push(storageId); },
        },
      },
    } as any, { prompt: "A detailed illustration" }), /artifact persistence failed/);

    assert.equal(scheduled[0]?.generationId, "image_generation_1");
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

test("generate_image recovers when publication commits but its response is lost", async () => {
  const originalFetch = globalThis.fetch;
  const originalEncryptionKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "generate-image-publication-retry-test-key";
  const encryptedApiKey = await encryptSecret(
    "openrouter-test-key",
    userApiKeySecretContext("user_1"),
    () => new Uint8Array(12).fill(6),
  );
  let queryCount = 0;
  let publicationAttempts = 0;
  const cleanupRequests: string[][] = [];
  const deleted: string[] = [];

  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const result = await generateImage.execute({
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1",
      executionFence: 1,
      toolCallId: "tool_call_1",
      operationIdempotencyKey: "job_1:generate_image:operation_1",
      ctx: {
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) {
            return {
              imageModelId: "openai/gpt-image-2",
              zdrEnabled: false,
              imageConfig: {},
            };
          }
          if (queryCount === 2) {
            return {
              hasImageGeneration: true,
              imageCapabilities: { supportedParameters: {} },
            };
          }
          if (queryCount === 3) return encryptedApiKey;
          return false;
        },
        runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
          if (Array.isArray(args.media)) {
            publicationAttempts += 1;
            if (publicationAttempts === 1) throw new Error("response lost after commit");
            return [];
          }
          if (Array.isArray(args.storageIds)) {
            cleanupRequests.push(args.storageIds as string[]);
          }
          return null;
        },
        storage: {
          store: async () => "storage_committed",
          getUrl: async () => "https://files.example/committed.png",
          delete: async (storageId: string) => { deleted.push(storageId); },
        },
      },
    } as any, { prompt: "A detailed illustration" });

    assert.equal(result.success, true);
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
