import assert from "node:assert/strict";
import test from "node:test";

import type { ActionCtx } from "../_generated/server";
import { dispatchDedicatedImageGeneration } from "../chat/action_image_generation";
import { isGenerationCancelledError } from "../chat/generation_helpers";

test("buffered image cancellation after storage cleans blobs before publication", async () => {
  const originalFetch = globalThis.fetch;
  const deleted: string[] = [];
  const mutations: unknown[] = [];
  let cancellationCheck = 0;

  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [{ b64_json: "AAEC", media_type: "image/png" }],
    }), { status: 200 })) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => "storage_image_1",
        getUrl: async () => "https://files.example/image.png",
        delete: async (storageId: string) => deleted.push(storageId),
      },
      runQuery: async () => {
        cancellationCheck += 1;
        return cancellationCheck >= 3;
      },
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
    assert.deepEqual(deleted, ["storage_image_1"]);
    assert.equal(mutations.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("durable image cancellation aborts blocked provider transport promptly", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: unknown[] = [];
  let cancellationChecks = 0;
  let transportStarted = false;
  let transportAborted = false;

  try {
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        transportStarted = true;
        const abort = () => {
          transportAborted = true;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        };
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener("abort", abort, { once: true });
      })) as typeof fetch;
    const ctx = {
      storage: {
        store: async () => "storage_image_1",
        getUrl: async () => "https://files.example/image.png",
        delete: async () => undefined,
      },
      runQuery: async () => {
        cancellationChecks += 1;
        return cancellationChecks >= 2;
      },
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
    assert.equal(transportStarted, true);
    assert.equal(transportAborted, true);
    assert.ok(cancellationChecks >= 2);
    assert.equal(mutations.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
