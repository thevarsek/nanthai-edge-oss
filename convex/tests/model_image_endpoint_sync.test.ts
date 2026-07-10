import assert from "node:assert/strict";
import test from "node:test";
import { upsertImageModelsBatch } from "../models/image_sync";
import { prepareImageModel } from "../models/image_sync_contract";
import type { ImageEndpointResponse } from "../models/image_sync_contract";
import { projectMediaCapabilities } from "../models/media_capabilities";
import { resolveImageGenerationOptions } from "../chat/image_generation_defaults";

type TestFunction = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const modelDescriptor = {
  id: "google/gemini-image",
  name: "Google: Gemini Image",
  architecture: {
    input_modalities: ["text", "image"],
    output_modalities: ["text", "image"],
  },
  supported_parameters: {
    resolution: { type: "enum", values: ["1K", "2K", "4K"] },
    quality: { type: "enum", values: ["low", "high"] },
  },
  supports_streaming: false,
};

const endpointDescriptor: ImageEndpointResponse = {
  endpoints: [
    {
      provider_name: "Google Vertex",
      provider_slug: "google-vertex",
      provider_tag: "google-vertex/us-east5",
      supported_parameters: {
        resolution: { type: "enum", values: ["1K", "2K"] },
      },
      allowed_passthrough_parameters: ["safety_filter_level"],
      supports_streaming: false,
      pricing: [{
        billable: "output_image",
        unit: "image",
        cost_usd: "0.08",
        variant: "2k",
      }],
    },
    {
      provider_name: "Google AI Studio",
      provider_slug: "google-ai-studio",
      provider_tag: null,
      supported_parameters: {
        resolution: { type: "enum", values: ["1K", "2K", "4K"] },
        quality: { type: "enum", values: ["low", "high"] },
      },
      allowed_passthrough_parameters: [],
      supports_streaming: true,
      pricing: [{
        billable: "output_image",
        unit: "megapixel",
        cost_usd: 0.012,
        variant: "4k",
      }],
    },
    {
      provider_name: "Google Default",
      provider_slug: "google",
      supported_parameters: {
        resolution: { type: "enum", values: ["1K", "2K", "4K"] },
        quality: { type: "enum", values: ["low", "high"] },
      },
      allowed_passthrough_parameters: [],
      supports_streaming: false,
      pricing: [{
        billable: "output_image",
        unit: "image",
        cost_usd: 0,
      }],
    },
  ],
};

test("prepareImageModel retains definitive endpoint capability records", () => {
  const prepared = prepareImageModel(modelDescriptor, endpointDescriptor);

  assert.deepEqual(
    prepared.imageCapabilities.supportedParameters,
    { resolution: { type: "enum", values: ["1K", "2K"] } },
  );
  assert.deepEqual(prepared.supportedParameters, ["resolution"]);
  assert.equal(prepared.imageCapabilities.supportsStreaming, false);
  assert.deepEqual(
    prepared.imageCapabilities.allowedPassthroughParameters,
    [],
  );
  assert.deepEqual(prepared.imageCapabilities.endpoints, [
    {
      providerName: "Google Vertex",
      providerSlug: "google-vertex",
      providerTag: "google-vertex/us-east5",
      supportedParameters: {
        resolution: { type: "enum", values: ["1K", "2K"] },
      },
      allowedPassthroughParameters: ["safety_filter_level"],
      supportsStreaming: false,
      pricing: [{
        billable: "output_image",
        unit: "image",
        costUsd: 0.08,
        variant: "2k",
      }],
    },
    {
      providerName: "Google AI Studio",
      providerSlug: "google-ai-studio",
      providerTag: null,
      supportedParameters: {
        resolution: { type: "enum", values: ["1K", "2K", "4K"] },
        quality: { type: "enum", values: ["low", "high"] },
      },
      allowedPassthroughParameters: [],
      supportsStreaming: true,
      pricing: [{
        billable: "output_image",
        unit: "megapixel",
        costUsd: 0.012,
        variant: "4k",
      }],
    },
    {
      providerName: "Google Default",
      providerSlug: "google",
      supportedParameters: {
        resolution: { type: "enum", values: ["1K", "2K", "4K"] },
        quality: { type: "enum", values: ["low", "high"] },
      },
      allowedPassthroughParameters: [],
      supportsStreaming: false,
      pricing: [{
        billable: "output_image",
        unit: "image",
        costUsd: 0,
        variant: undefined,
      }],
    },
  ]);
  assert.equal(
    prepared.imageCapabilities.pricing.some((line) => line.costUsd === 0),
    false,
  );
});

test("effective endpoint capabilities drive projection and runtime adaptation", () => {
  const prepared = prepareImageModel(modelDescriptor, endpointDescriptor);
  const projected = projectMediaCapabilities(prepared);

  assert.deepEqual(projected.image?.resolutions, ["1K", "2K"]);
  assert.deepEqual(projected.image?.qualities, []);
  assert.deepEqual(resolveImageGenerationOptions({
    resolution: "4K",
    quality: "high",
  }, prepared.imageCapabilities.supportedParameters), {
    resolution: "2K",
  });
});

test("image model preparation fails closed without endpoint records", () => {
  const prepared = prepareImageModel(modelDescriptor, { endpoints: [] });

  assert.deepEqual(prepared.imageCapabilities.supportedParameters, {});
  assert.deepEqual(prepared.supportedParameters, []);
  assert.equal(prepared.imageCapabilities.supportsStreaming, false);
  assert.deepEqual(prepared.imageCapabilities.allowedPassthroughParameters, []);
});

test("endpoint-safe input reference ranges drive the floored attachment limit", () => {
  const prepared = prepareImageModel({
    ...modelDescriptor,
    supported_parameters: {
      input_references: { type: "range", min: 0, max: 16 },
    },
    supports_streaming: true,
  }, {
    endpoints: [
      {
        provider_slug: "one",
        supported_parameters: {
          input_references: { type: "range", min: 0, max: 14.8 },
        },
        supports_streaming: true,
      },
      {
        provider_slug: "two",
        supported_parameters: {
          input_references: { type: "range", min: 0, max: 16 },
        },
        supports_streaming: true,
      },
    ],
  });

  assert.deepEqual(prepared.imageCapabilities.supportedParameters, {
    input_references: { type: "range", min: 0, max: 14.8 },
  });
  assert.equal(prepared.imageCapabilities.maxInputReferences, 14);
  assert.equal(prepared.imageCapabilities.supportsStreaming, true);
});

test("image sync upsert stores the endpoint records without changing chat fields", async () => {
  const prepared = prepareImageModel(modelDescriptor, endpointDescriptor);
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({
            _id: "model_1",
            modelId: prepared.modelId,
            supportedParameters: ["tools"],
            architecture: { modality: "text->text+image" },
          }),
        }),
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  };

  await (upsertImageModelsBatch as unknown as TestFunction)._handler(ctx, {
    models: [prepared],
  });

  assert.equal(patches[0]?.supportedParameters, undefined);
  const imageCapabilities = patches[0]?.imageCapabilities as {
    endpoints?: unknown[];
  };
  assert.deepEqual(
    imageCapabilities.endpoints,
    prepared.imageCapabilities.endpoints,
  );
});
