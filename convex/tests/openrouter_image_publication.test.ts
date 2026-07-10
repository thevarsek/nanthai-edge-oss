import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import type { ActionCtx } from "../_generated/server";
import { dispatchDedicatedImageGeneration } from "../chat/action_image_generation";
import { isGenerationCancelledError } from "../chat/generation_helpers";
import { assertOpenRouterImagePrivacy } from "../lib/openrouter_image";

test("dedicated image publication loses atomically to a late cancellation", async () => {
  const originalFetch = globalThis.fetch;
  const deleted: string[] = [];
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
    assert.deepEqual(deleted, ["storage_late_cancel"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("partial image publication retains the generation ID after a body failure", async () => {
  const originalFetch = globalThis.fetch;
  let publication: Record<string, unknown> | undefined;
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dedicated image privacy guard rejects protected requests before fetch", async () => {
  assert.throws(
    () => assertOpenRouterImagePrivacy(true),
    (error: unknown) =>
      error instanceof ConvexError &&
      error.data?.code === "IMAGE_GENERATION_ZDR_UNAVAILABLE",
  );

  const originalFetch = globalThis.fetch;
  let fetched = false;
  try {
    globalThis.fetch = (async () => {
      fetched = true;
      return new Response();
    }) as typeof fetch;
    await assert.rejects(
      dispatchDedicatedImageGeneration({
        ctx: {} as ActionCtx,
        userId: "user_1",
        chatId: "chat_1" as never,
        messageId: "message_1" as never,
        jobId: "job_1" as never,
        modelId: "openai/gpt-image-2",
        requestMessages: [{ role: "user", content: "A cat" }],
        prompt: "A cat",
        apiKey: "test-key",
        requireZdr: true,
      }),
      (error: unknown) =>
        error instanceof ConvexError &&
        error.data?.code === "IMAGE_GENERATION_ZDR_UNAVAILABLE",
    );
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
