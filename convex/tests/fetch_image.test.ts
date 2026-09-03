import assert from "node:assert/strict";
import test from "node:test";
import { fetchImage } from "../tools/fetch_image";

function toolContext(overrides: Record<string, unknown> = {}) {
  return {
    ctx: {
      runQuery: async () => [],
      runMutation: async () => "attachment_1",
      runAction: async () => {
        throw new Error("Unexpected runAction");
      },
      storage: {
        get: async () => null,
        store: async () => "stored_image_1",
        delete: async () => undefined,
      },
      ...overrides,
    },
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1",
    executionFence: 3,
    toolCallId: "call_1",
  } as never;
}

test("fetch_image delegates public URLs with the fenced user-owned context", async () => {
  const actionArgs: Array<Record<string, unknown>> = [];
  const result = await fetchImage.execute(toolContext({
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      actionArgs.push(args);
      return {
        success: true,
        data: {
          imageStorageId: "stored_image_1",
          mimeType: "image/png",
          source: "url",
        },
      };
    },
  }), { url: "https://example.com/hero.png" });

  assert.equal(result.success, true);
  assert.equal((result.data as { imageStorageId?: string }).imageStorageId, "stored_image_1");
  assert.deepEqual(actionArgs, [{
    url: "https://example.com/hero.png",
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1",
    executionFence: 3,
  }]);
});

test("fetch_image validates that an existing storage image is user-owned", async () => {
  let storageReads = 0;
  const unowned = await fetchImage.execute(toolContext({
    runQuery: async () => [],
    storage: {
      get: async () => {
        storageReads += 1;
        return new Blob([new Uint8Array([1])], { type: "image/png" });
      },
      store: async () => "unused",
      delete: async () => undefined,
    },
  }), { storageId: "foreign_image" });

  assert.equal(unowned.success, false);
  assert.match(unowned.error ?? "", /not found or is not owned/);
  assert.equal(storageReads, 0);

  const owned = await fetchImage.execute(toolContext({
    runQuery: async () => [{ storageId: "owned_image" }],
    storage: {
      get: async () => new Blob([new Uint8Array([1, 2])], { type: "image/jpeg" }),
      store: async () => "unused",
      delete: async () => undefined,
    },
  }), { storageId: "owned_image" });

  assert.equal(owned.success, true);
  assert.equal((owned.data as { source?: string }).source, "storage");
});

test("fetch_image rejects non-public URL schemes before Node delegation", async () => {
  let actionCalls = 0;
  const ctx = toolContext({
    runAction: async () => {
      actionCalls += 1;
      throw new Error("Unexpected runAction");
    },
  });

  const malformed = await fetchImage.execute(ctx, { url: "not a URL" });
  const unsupported = await fetchImage.execute(ctx, { url: "ftp://example.com/hero.png" });

  assert.equal(malformed.success, false);
  assert.match(malformed.error ?? "", /valid HTTP\(S\) URL/);
  assert.equal(unsupported.success, false);
  assert.match(unsupported.error ?? "", /must start with http/);
  assert.equal(actionCalls, 0);
});
