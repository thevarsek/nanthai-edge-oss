import assert from "node:assert/strict";
import test from "node:test";
import type { ActionCtx } from "../_generated/server";
import { dispatchDedicatedImageGeneration } from "../chat/action_image_generation";

test("model-default image count preserves every successful provider output", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [
        { b64_json: "AAEC", media_type: "image/png" },
        { b64_json: "AwQF", media_type: "image/png" },
      ],
    }), { status: 200 })) as typeof fetch;
    let storedCount = 0;
    const context = {
      storage: {
        store: async () => `storage_default_${++storedCount}`,
        getUrl: async (storageId: string) => `https://files.example/${storageId}`,
        delete: async () => undefined,
      },
      runQuery: async () => false,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        if (Array.isArray(args.images)) return { published: true, cancelled: false };
      },
    };

    const result = await dispatchDedicatedImageGeneration({
      ctx: context as unknown as ActionCtx,
      userId: "user_1",
      chatId: "chat_1" as never,
      messageId: "message_1" as never,
      jobId: "job_1" as never,
      modelId: "openai/gpt-image-2",
      requestMessages: [{ role: "user", content: "Two cats" }],
      prompt: "Two cats",
      apiKey: "test-key",
      requireZdr: false,
    });

    assert.equal(
      mutations.find((args) => args.expectedCount !== undefined)?.expectedCount,
      1,
    );
    const publication = mutations.find((args) => Array.isArray(args.images));
    assert.equal(publication?.requestedCount, 2);
    assert.equal((publication?.images as unknown[]).length, 2);
    assert.equal(result.imageUrls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("post-storage cancellation read failures fail open and still publish images", async () => {
  const originalFetch = globalThis.fetch;
  let imageStored = false;
  let postStorageFailureEmitted = false;
  let publication: Record<string, unknown> | undefined;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), { status: 200 })) as typeof fetch;
    const context = {
      storage: {
        store: async () => {
          imageStored = true;
          return "storage_image_1";
        },
        getUrl: async () => "https://files.example/image.png",
        delete: async () => undefined,
      },
      runQuery: async () => {
        if (imageStored && !postStorageFailureEmitted) {
          postStorageFailureEmitted = true;
          throw new Error("cancellation query unavailable");
        }
        return false;
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (Array.isArray(args.images)) {
          publication = args;
          return { published: true, cancelled: false };
        }
      },
    };

    const result = await dispatchDedicatedImageGeneration({
      ctx: context as unknown as ActionCtx,
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
    assert.equal((publication?.images as unknown[]).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pre-storage cancellation read failures fail open and preserve paid output", async () => {
  const originalFetch = globalThis.fetch;
  let queryCount = 0;
  let stored = false;
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), { status: 200 })) as typeof fetch;
    const context = {
      storage: {
        store: async () => {
          stored = true;
          return "storage_image_1";
        },
        getUrl: async () => "https://files.example/image.png",
        delete: async () => undefined,
      },
      runQuery: async () => {
        queryCount += 1;
        if (queryCount === 2) throw new Error("transient cancellation read");
        return false;
      },
      runMutation: async (_ref: unknown, args: Record<string, unknown>) =>
        Array.isArray(args.images) ? { published: true, cancelled: false } : undefined,
    };

    const result = await dispatchDedicatedImageGeneration({
      ctx: context as unknown as ActionCtx,
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

    assert.equal(stored, true);
    assert.equal(result.imageUrls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
