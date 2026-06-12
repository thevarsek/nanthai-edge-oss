import assert from "node:assert/strict";
import test from "node:test";

import { prepareGenerationContext } from "../chat/actions_run_generation_context";

test("prepareGenerationContext hydrates image URLs without reading stored document blobs", async () => {
  const capabilityQueries: string[] = [];
  let storageReads = 0;
  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("chatId" in args) {
        return [
          {
            _id: "msg_1",
            role: "user",
            content: "hello",
            attachments: [
              { type: "image", storageId: "img_1", url: "stale" },
              { type: "document", storageId: "doc_1", mimeType: "application/pdf" },
            ],
          },
        ];
      }
      capabilityQueries.push(String(args.modelId));
      return { hasReasoning: true };
    },
    storage: {
      getUrl: async () => "https://cdn.example/img_1.png",
      get: async () => {
        storageReads += 1;
        return null;
      },
      store: async () => {
        throw new Error("not used");
      },
    },
  } as any;

  const result = await prepareGenerationContext(ctx, {
    chatId: "chat_1",
    participants: [
      { modelId: "model_a" },
      { modelId: "model_a" },
      { modelId: "model_b" },
    ],
  } as any);

  assert.deepEqual(capabilityQueries, ["model_a", "model_b"]);
  assert.equal(result.memoryContext, undefined);
  assert.equal(result.modelCapabilities.size, 2);
  assert.equal(
    result.allMessages[0]?.attachments?.[0]?.url,
    "https://cdn.example/img_1.png",
  );
  assert.equal(result.allMessages[0]?.attachments?.[1]?.url, undefined);
  assert.equal(storageReads, 0);
});
