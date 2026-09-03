import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import {
  dispatchDedicatedImageGeneration,
  runDedicatedImageGeneration,
} from "../chat/action_image_generation";
import { isGenerationCancelledError } from "../chat/generation_helpers";

test("dedicated image action persists images and finalizes the shared message", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<{ args: Record<string, unknown> }> = [];
  let providerDispatchCount = 0;
  try {
    globalThis.fetch = (async () => {
      assert.equal(providerDispatchCount, 1, "journal transition precedes provider POST");
      return new Response(JSON.stringify({
        data: [
          { b64_json: "AAEC", media_type: "image/png" },
          { b64_json: "AwQF", media_type: "image/png" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }), { status: 200 });
    }) as typeof fetch;
    let storedCount = 0;
    const ctx = {
      storage: {
        store: async () => `storage_image_${++storedCount}`,
        getUrl: async (id: string) => `https://files.example/${id}.png`,
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push({ args });
        if (Array.isArray(args.images)) {
          return { published: true, cancelled: false };
        }
      },
      runQuery: async () => false,
    };

    const generated = await runDedicatedImageGeneration({
      ctx: ctx as unknown as ActionCtx,
      generation: {
        chatId: "chat_1",
        userMessageId: "user_message_1",
        assistantMessageIds: ["assistant_1"],
        generationJobIds: ["job_1"],
        participants: [],
        userId: "user_1",
        expandMultiModelGroups: true,
        webSearchEnabled: false,
        imageConfig: { count: 2 },
      } as never,
      participant: {
        modelId: "openai/gpt-image-2",
        messageId: "assistant_1",
        jobId: "job_1",
      } as never,
      requestMessages: [{ role: "user", content: "A cat" }],
      prompt: "A cat",
      apiKey: "test-key",
      supportedParameters: { n: { type: "range", min: 1, max: 1 } },
      requireZdr: false,
      onProviderDispatch: async () => {
        providerDispatchCount += 1;
      },
    });

    const publication = mutations.find(({ args }) => Array.isArray(args.images))?.args;
    const pendingProjection = mutations.find(({ args }) => args.expectedCount !== undefined)?.args;
    assert.equal(pendingProjection?.expectedCount, 1);
    assert.equal(publication?.modelId, "openai/gpt-image-2");
    assert.equal(publication?.prompt, "A cat");
    assert.equal(publication?.requestedCount, 1);
    assert.deepEqual(publication?.images, [
      {
        url: "https://files.example/storage_image_1.png",
        storageId: "storage_image_1",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ]);
    assert.equal(generated.imageCount, 1);
    assert.equal(providerDispatchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated image dispatch honors cancellation before persistence", async () => {
  const originalFetch = globalThis.fetch;
  let stored = false;
  const mutations: unknown[] = [];
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), { status: 200 })) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => {
          stored = true;
          return "storage_image_1";
        },
        getUrl: async () => "https://files.example/image.png",
      },
      runQuery: async () => true,
      runMutation: async (...args: unknown[]) => mutations.push(args),
    };

    await assert.rejects(
      dispatchDedicatedImageGeneration({
        ctx: ctx as unknown as ActionCtx,
        userId: "user_1",
        chatId: "chat_1" as never,
        messageId: "message_1" as never,
        jobId: "job_1" as never,
        modelId: "openai/gpt-image-2",
        requestMessages: [{ role: "user", content: "A cat" }],
        prompt: "A cat",
        apiKey: "test-key",
        requireZdr: false,
      }),
      isGenerationCancelledError,
    );
    assert.equal(stored, false);
    assert.equal((mutations[0] as [unknown, Record<string, unknown>])[1].expectedCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated image dispatch keeps successful images when one cannot be stored", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [
        { b64_json: "AAEC", media_type: "image/png" },
        { b64_json: "AwQF", media_type: "image/png" },
        { b64_json: "BgcI", media_type: "image/webp" },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
    }), { status: 200 })) as typeof fetch;
    let storeAttempt = 0;
    const ctx = {
      storage: {
        store: async () => {
          storeAttempt += 1;
          if (storeAttempt === 2) throw new Error("storage unavailable");
          return `storage_${storeAttempt}`;
        },
        getUrl: async (storageId: string) => `https://files.example/${storageId}`,
        delete: async () => undefined,
      },
      runQuery: async () => false,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        if (Array.isArray(args.images)) {
          return { published: true, cancelled: false };
        }
      },
    };

    const result = await dispatchDedicatedImageGeneration({
      ctx: ctx as unknown as ActionCtx,
      userId: "user_1",
      chatId: "chat_1" as never,
      messageId: "message_1" as never,
      jobId: "job_1" as never,
      modelId: "openai/gpt-image-2",
      requestMessages: [{ role: "user", content: "Three cats" }],
      prompt: "Three cats",
      apiKey: "test-key",
      imageConfig: { count: 3 },
      supportedParameters: { n: { type: "range", min: 1, max: 10 } },
      requireZdr: false,
    });

    assert.deepEqual(result.imageUrls, [
      "https://files.example/storage_1",
      "https://files.example/storage_3",
    ]);
    const publication = mutations.find((args) => Array.isArray(args.images));
    assert.equal(publication?.requestedCount, 3);
    assert.deepEqual(
      (publication?.images as Array<Record<string, unknown>>).map((image) => image.mimeType),
      ["image/png", "image/webp"],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated image publication survives a lost commit response", async () => {
  const originalFetch = globalThis.fetch;
  const cleanupRequests: string[][] = [];
  const directDeletes: string[] = [];
  let publicationAttempts = 0;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), { status: 200 })) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => "storage_committed_image",
        getUrl: async () => "https://files.example/committed.png",
        delete: async (storageId: string) => { directDeletes.push(storageId); },
      },
      runQuery: async () => false,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (args.expectedCount !== undefined) return null;
        if (Array.isArray(args.images)) {
          publicationAttempts += 1;
          if (publicationAttempts === 1) throw new Error("response lost after commit");
          return { published: true, cancelled: false };
        }
        if (Array.isArray(args.storageIds)) {
          cleanupRequests.push(args.storageIds as string[]);
          return null;
        }
        throw new Error("Unexpected mutation");
      },
    };

    const result = await dispatchDedicatedImageGeneration({
      ctx: ctx as unknown as ActionCtx,
      userId: "user_1",
      chatId: "chat_1" as never,
      messageId: "message_1" as never,
      jobId: "job_1" as never,
      modelId: "openai/gpt-image-2",
      requestMessages: [{ role: "user", content: "A cat" }],
      prompt: "A cat",
      apiKey: "test-key",
      requireZdr: false,
    });

    assert.equal(result.imageUrls.length, 1);
    assert.equal(publicationAttempts, 2);
    assert.deepEqual(cleanupRequests, []);
    assert.deepEqual(directDeletes, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image provider failures survive a durable cancellation query failure", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { message: "Provider rejected the image request" },
    }), { status: 400 })) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => "storage_image_1",
        getUrl: async () => "https://files.example/image.png",
        delete: async () => undefined,
      },
      runQuery: async () => {
        throw new Error("durable cancellation read unavailable");
      },
      runMutation: async () => undefined,
    };

    await assert.rejects(
      dispatchDedicatedImageGeneration({
        ctx: ctx as unknown as ActionCtx,
        userId: "user_1",
        chatId: "chat_1" as never,
        messageId: "message_1" as never,
        jobId: "job_1" as never,
        modelId: "openai/gpt-image-2",
        requestMessages: [{ role: "user", content: "A cat" }],
        prompt: "A cat",
        apiKey: "test-key",
        requireZdr: false,
      }),
      (error: unknown) =>
        error instanceof ConvexError &&
        String(error.data?.message).includes("OpenRouter request failed (HTTP 400)") &&
        !String(error.data?.message).includes("durable cancellation read unavailable"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
