import assert from "node:assert/strict";
import test from "node:test";
import {
  syncImageModels,
} from "../models/image_sync";
import { prepareImageModel } from "../models/image_sync_contract";
import {
  gptImageEndpoints,
  gptImageModel,
} from "./support/model_image_sync_fixtures.test";

type TestFunction = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

test("prepareImageModel maps the dedicated GPT Image 2 descriptor", () => {
  const model = prepareImageModel(gptImageModel, gptImageEndpoints);
  assert.equal(model.modelId, "openai/gpt-image-2");
  assert.equal(model.imageOnly, true);
  assert.equal(model.architecture.modality, "text+image->image");
  assert.equal(model.imageCapabilities.supportsStreaming, true);
  assert.equal(model.imageCapabilities.maxInputReferences, 16);
  assert.deepEqual(model.imageCapabilities.pricingSkus, {
    imageToken: "0.00003",
    imageOutput: "0.00003",
  });
  assert.deepEqual(model.imageCapabilities.allowedPassthroughParameters, [
    "moderation",
  ]);
});

test("prepareImageModel preserves image and megapixel pricing units", () => {
  const model = prepareImageModel({
    ...gptImageModel,
    id: "example/unit-priced-image",
  }, {
    endpoints: [{
      provider_slug: "example",
      pricing: [
        { billable: "output_image", unit: "image", cost_usd: 0.04 },
        { billable: "output_image", unit: "megapixel", cost_usd: 0.012 },
      ],
    }],
  });

  assert.equal(model.imageCapabilities.pricePerImage, 0.04);
  assert.equal(model.imageCapabilities.pricePerMegapixel, 0.012);
  assert.equal(model.imageCapabilities.pricingSkus, undefined);
});

test("syncImageModels reads dedicated discovery and root endpoint records", async () => {
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  const mutationArgs: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      const value = String(url);
      urls.push(value);
      const payload = value.endsWith("/images/models")
        ? { data: [gptImageModel] }
        : gptImageEndpoints;
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch;
    const ctx = {
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutationArgs.push(args);
        if ("activeModelIds" in args) return { deleted: 0 };
        return { upserted: 1, created: 1 };
      },
    };

    await (syncImageModels as unknown as TestFunction)._handler(ctx, {});

    assert.deepEqual(urls, [
      "https://openrouter.ai/api/v1/images/models",
      "https://openrouter.ai/api/v1/images/models/openai/gpt-image-2/endpoints",
    ]);
    const models = mutationArgs[0]?.models as Array<Record<string, unknown>>;
    const capabilities = models[0]?.imageCapabilities as Record<string, unknown>;
    assert.equal(capabilities.maxInputReferences, 16);
    assert.equal(capabilities.supportsStreaming, true);
    assert.deepEqual(mutationArgs[1]?.activeModelIds, ["openai/gpt-image-2"]);
    assert.deepEqual(mutationArgs[1]?.unavailableModelIds, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sync skips endpoint-enrichment failures without dropping active IDs", async () => {
  const originalFetch = globalThis.fetch;
  const mutationArgs: Array<Record<string, unknown>> = [];
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/images/models")) {
        return new Response(JSON.stringify({ data: [gptImageModel] }), {
          status: 200,
        });
      }
      return new Response("temporary endpoint failure", { status: 503 });
    }) as typeof fetch;
    const ctx = {
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutationArgs.push(args);
        return { deleted: 0 };
      },
    };

    await (syncImageModels as unknown as TestFunction)._handler(ctx, {});

    assert.equal(mutationArgs.some((args) => "models" in args), false);
    assert.deepEqual(mutationArgs, [{
      activeModelIds: ["openai/gpt-image-2"],
      unavailableModelIds: [],
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
