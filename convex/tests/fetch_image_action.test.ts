import assert from "node:assert/strict";
import test from "node:test";

import {
  detectImageMimeType,
  fetchPublicImageHandler,
} from "../tools/fetch_image_action";

const args = {
  url: "https://images.example/hero",
  userId: "user_1",
  chatId: "chat_1",
  messageId: "message_1",
  jobId: "job_1",
  executionAttemptId: "attempt_1",
  executionFence: 3,
} as never;

function pngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
  ]);
}

test("public image fetch sniffs content and survives a lost publication response", async () => {
  const publicationArgs: Array<Record<string, unknown>> = [];
  const cleanupRequests: string[][] = [];
  let publicationAttempts = 0;
  let storedType: string | undefined;
  const ctx = {
    storage: {
      store: async (blob: Blob) => {
        storedType = blob.type;
        return "storage_image_1";
      },
    },
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      if (Array.isArray(mutationArgs.storageIds)) {
        cleanupRequests.push(mutationArgs.storageIds as string[]);
        return null;
      }
      publicationArgs.push(mutationArgs);
      publicationAttempts += 1;
      if (publicationAttempts === 1) throw new Error("response lost after commit");
      return "attachment_1";
    },
  };

  const result = await fetchPublicImageHandler(ctx as never, args, {
    fetchPublicImageThroughGateway: async () => new Response(pngBytes().buffer as ArrayBuffer, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    }),
  });

  assert.equal(result.success, true);
  assert.equal(storedType, "image/png");
  assert.equal(publicationAttempts, 2);
  assert.deepEqual(cleanupRequests, []);
  assert.deepEqual(publicationArgs[0], publicationArgs[1]);
  assert.equal(publicationArgs[0]?.storageId, "storage_image_1");
  assert.equal(publicationArgs[0]?.mimeType, "image/png");
});

test("public image fetch requests reference-aware cleanup after repeated publication failure", async () => {
  const cleanupRequests: string[][] = [];
  let publicationAttempts = 0;
  const ctx = {
    storage: { store: async () => "storage_orphan_candidate" },
    runMutation: async (_ref: unknown, mutationArgs: Record<string, unknown>) => {
      if (Array.isArray(mutationArgs.storageIds)) {
        cleanupRequests.push(mutationArgs.storageIds as string[]);
        return null;
      }
      publicationAttempts += 1;
      throw new Error("STALE_EXECUTION_FENCE");
    },
  };

  const result = await fetchPublicImageHandler(ctx as never, args, {
    fetchPublicImageThroughGateway: async () =>
      new Response(pngBytes().buffer as ArrayBuffer, { status: 200 }),
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /STALE_EXECUTION_FENCE/);
  assert.equal(publicationAttempts, 2);
  assert.deepEqual(cleanupRequests, [["storage_orphan_candidate"]]);
});

test("public image fetch rejects non-image content before storage", async () => {
  let storeCalls = 0;
  const ctx = {
    storage: {
      store: async () => {
        storeCalls += 1;
        return "unexpected";
      },
    },
    runMutation: async () => "unexpected",
  };

  const result = await fetchPublicImageHandler(ctx as never, args, {
    fetchPublicImageThroughGateway: async () => new Response(
      new TextEncoder().encode("<html>not an image</html>"),
      { status: 200, headers: { "content-type": "image/png" } },
    ),
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /did not return a supported image/);
  assert.equal(storeCalls, 0);
  assert.equal(detectImageMimeType(new TextEncoder().encode("not an image")), null);
});

test("public image fetch cancels an oversized streaming body before storage", async () => {
  let cancelled = false;
  let storeCalls = 0;
  const chunks = [
    new Uint8Array(6 * 1024 * 1024),
    new Uint8Array(5 * 1024 * 1024),
  ];
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
    },
    cancel() {
      cancelled = true;
    },
  });
  const ctx = {
    storage: {
      store: async () => {
        storeCalls += 1;
        return "unexpected";
      },
    },
    runMutation: async () => "unexpected",
  };

  const result = await fetchPublicImageHandler(ctx as never, args, {
    fetchPublicImageThroughGateway: async () => new Response(body, { status: 200 }),
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /exceeds 10MB limit/);
  assert.equal(cancelled, true);
  assert.equal(storeCalls, 0);
});

test("public image fetch cancels a declared oversized body before reading it", async () => {
  let cancelled = false;
  let storeCalls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      // The declared size rejects this response before a chunk is requested.
    },
    cancel() {
      cancelled = true;
    },
  });
  const ctx = {
    storage: {
      store: async () => {
        storeCalls += 1;
        return "unexpected";
      },
    },
    runMutation: async () => "unexpected",
  };

  const result = await fetchPublicImageHandler(ctx as never, args, {
    fetchPublicImageThroughGateway: async () => new Response(body, {
      status: 200,
      headers: { "content-length": String(11 * 1024 * 1024) },
    }),
  });

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /exceeds 10MB limit/);
  assert.equal(cancelled, true);
  assert.equal(storeCalls, 0);
});
