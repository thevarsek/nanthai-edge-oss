import assert from "node:assert/strict";
import test from "node:test";
import type { ActionCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { dispatchDedicatedImageGeneration } from "../chat/action_image_generation";
import { isGenerationCancelledError } from "../chat/generation_helpers";
import { publishGeneratedImages } from "../chat/image_generation_mutations";

test("dedicated image publication loses atomically to a late cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const deleted: string[] = [];
  const cleanupRequests: string[][] = [];
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), { status: 200 })) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => "storage_late_cancel",
        getUrl: async () => "https://files.example/late-cancel.png",
        delete: async (storageId: string) => { deleted.push(storageId); },
      },
      runQuery: async () => false,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (args.expectedCount !== undefined) return null;
        if (Array.isArray(args.images)) {
          return { published: false, cancelled: true };
        }
        if (Array.isArray(args.storageIds)) {
          cleanupRequests.push(args.storageIds as string[]);
          return null;
        }
        throw new Error("Unexpected mutation");
      },
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
    assert.deepEqual(cleanupRequests, [["storage_late_cancel"]]);
    assert.deepEqual(deleted, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("completed image publication recognizes only its exact committed storage set", async () => {
  const rows = {
    generationJobs: [{
      _id: "job_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      status: "completed",
    }],
    generatedMedia: [{
      _id: "media_1",
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      storageId: "storage_committed",
      type: "image",
    }],
  };
  const ctx = createStatefulMockCtx(rows);
  const baseArgs = {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    modelId: "openai/gpt-image-2",
    prompt: "A cat",
    requestedCount: 1,
  };

  const exact = await (publishGeneratedImages as any)._handler(ctx, {
    ...baseArgs,
    images: [{
      storageId: "storage_committed",
      url: "https://files.example/committed.png",
      mimeType: "image/png",
      sizeBytes: 3,
    }],
  });
  const mismatch = await (publishGeneratedImages as any)._handler(ctx, {
    ...baseArgs,
    images: [{
      storageId: "storage_other",
      url: "https://files.example/other.png",
      mimeType: "image/png",
      sizeBytes: 3,
    }],
  });

  assert.deepEqual(exact, { published: true, cancelled: false });
  assert.deepEqual(mismatch, { published: false, cancelled: false });
});

test("partial image publication retains the generation ID after a body failure", async () => {
  const originalFetch = globalThis.fetch;
  let publication: Record<string, unknown> | undefined;
  const scheduled: Array<Record<string, unknown>> = [];
  try {
    let pullCount = 0;
    globalThis.fetch = (async () => new Response(new ReadableStream({
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new TextEncoder().encode(
            '{"data":[{"b64_json":"AAEC","media_type":"image/png"}]',
          ));
          return;
        }
        controller.error(new Error("upstream body disconnected"));
      },
    }), {
      status: 200,
      headers: { "X-Generation-Id": "generation_partial" },
    })) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => "storage_partial",
        getUrl: async () => "https://files.example/partial.png",
        delete: async () => undefined,
      },
      runQuery: async () => false,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (args.expectedCount !== undefined) return null;
        if (Array.isArray(args.images)) {
          publication = args;
          return { published: true, cancelled: false };
        }
        throw new Error("Unexpected mutation");
      },
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push(args);
        },
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
      imageConfig: { count: 2 },
      supportedParameters: { n: { type: "range", min: 1, max: 10 } },
      requireZdr: false,
    });

    assert.equal(result.generationId, "generation_partial");
    assert.equal(publication?.openrouterGenerationId, "generation_partial");
    assert.equal(publication?.requestedCount, 2);
    assert.equal("usage" in (publication ?? {}), false);
    assert.equal(scheduled[0]?.source, "media_message_image");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated image generation rejects ZDR before contacting OpenRouter", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  try {
    globalThis.fetch = (async () => {
      fetchCount += 1;
      throw new Error("OpenRouter should not be called for protected image generation");
    }) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => "storage_zdr",
        getUrl: async () => "https://files.example/zdr.png",
        delete: async () => undefined,
      },
      runQuery: async () => false,
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (args.expectedCount !== undefined) return null;
        if (Array.isArray(args.images)) return { published: true, cancelled: false };
        throw new Error("Unexpected mutation");
      },
    };
    await assert.rejects(
      dispatchDedicatedImageGeneration({
        ctx: ctx as unknown as ActionCtx,
        userId: "user_1",
        chatId: "chat_1" as never,
        messageId: "message_1" as never,
        jobId: "job_1" as never,
        modelId: "bytedance-seed/seedream-4.5",
        requestMessages: [{ role: "user", content: "A cat" }],
        prompt: "A cat",
        apiKey: "test-key",
        requireZdr: true,
      }),
      (error: unknown) => error instanceof Error &&
        error.message.includes("Image generation is unavailable"),
    );
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
