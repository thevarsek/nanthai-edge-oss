import assert from "node:assert/strict";
import test from "node:test";

import { syncImageModels } from "../models/image_sync";

type TestFunction = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

function imageModel(id: string) {
  return {
    id,
    name: id,
    architecture: {
      input_modalities: ["text"],
      output_modalities: ["image"],
    },
    supported_parameters: {},
    supports_streaming: false,
  };
}

const zeroEndpointModelIds = [
  "sourceful/riverflow-v2-max-preview",
  "sourceful/riverflow-v2-standard-preview",
  "sourceful/riverflow-v2-fast-preview",
  "google/gemini-2.5-flash-image-preview",
  "openrouter/auto",
];

test("image sync prunes empty/404 endpoint models but preserves transient rows", async () => {
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const value = String(url);
      if (value.endsWith("/images/models")) {
        return new Response(JSON.stringify({
          data: [
            imageModel("example/available"),
            ...zeroEndpointModelIds.map(imageModel),
            imageModel("example/not-found"),
            imageModel("example/transient"),
          ],
        }), { status: 200 });
      }
      if (value.endsWith("example/available/endpoints")) {
        return new Response(JSON.stringify({ endpoints: [{ pricing: [] }] }), {
          status: 200,
        });
      }
      if (zeroEndpointModelIds.some((modelId) =>
        value.endsWith(`${modelId}/endpoints`)
      )) {
        return new Response(JSON.stringify({ endpoints: [] }), { status: 200 });
      }
      if (value.endsWith("example/not-found/endpoints")) {
        return new Response("not found", { status: 404 });
      }
      return new Response("temporary failure", { status: 503 });
    }) as typeof fetch;

    const ctx = {
      runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        if ("models" in args) return { upserted: 1, created: 1 };
        return { deleted: 2, deactivated: 0 };
      },
    };
    await (syncImageModels as unknown as TestFunction)._handler(ctx, {});

    const upsert = mutations[0]?.models as Array<{ modelId: string }>;
    assert.deepEqual(upsert.map((model) => model.modelId), ["example/available"]);
    assert.deepEqual(mutations[1]?.activeModelIds, [
      "example/available",
      "example/transient",
    ]);
    assert.deepEqual(mutations[1]?.unavailableModelIds, [
      ...zeroEndpointModelIds,
      "example/not-found",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
