import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { callOpenRouterNonStreaming } from "../lib/openrouter_nonstream";
import {
  assertChatCompletionsRequest,
  assertModelAvailable,
  assertTextGenerationModel,
  resolveTextAncillaryModel,
} from "../lib/openrouter_modality";

test("text-only workflows reject image-generation models clearly", () => {
  assert.throws(
    () => assertModelAvailable({
      modelId: "example/pruned-model",
      capabilities: null,
      feature: "Generation",
    }),
    (error: unknown) =>
      error instanceof ConvexError && error.data.code === "MODEL_UNAVAILABLE",
  );
  assert.throws(
    () => assertTextGenerationModel({
      feature: "Search synthesis",
      hasImageGeneration: true,
    }),
    (error: unknown) =>
      error instanceof ConvexError &&
      error.data.code === "MEDIA_MODEL_UNSUPPORTED_FOR_TEXT" &&
      String(error.data.message).includes("text-capable model"),
  );
  assert.doesNotThrow(() => assertTextGenerationModel({
    feature: "Search synthesis",
      hasImageGeneration: false,
      hasVideoGeneration: false,
      hasAudioOutput: false,
  }));
});

test("chat-completions transport blocks image modalities", async () => {
  assert.throws(
    () => assertChatCompletionsRequest({ modalities: ["image"] }),
    (error: unknown) =>
      error instanceof ConvexError && error.data.code === "IMAGE_API_REQUIRED",
  );
  assert.throws(
    () => assertChatCompletionsRequest({ imageConfig: { imageSize: "1024x1024" } }),
    (error: unknown) =>
      error instanceof ConvexError && error.data.code === "IMAGE_API_REQUIRED",
  );

  let fetched = false;
  await assert.rejects(
    callOpenRouterNonStreaming(
      "test-key",
      "openai/gpt-image-2",
      [{ role: "user", content: "A cat" }],
      { modalities: ["image"] },
      {},
      {
        fetch: async () => {
          fetched = true;
          return new Response();
        },
      } as never,
    ),
    (error: unknown) =>
      error instanceof ConvexError && error.data.code === "IMAGE_API_REQUIRED",
  );
  assert.equal(fetched, false);
});

test("ancillary text work falls back from configured image models", async () => {
  const queried: string[] = [];
  const resolved = await resolveTextAncillaryModel({
    selectedModel: "openai/gpt-image-2",
    defaultModel: "openai/gpt-4.1-mini",
    feature: "Title generation",
    getCapabilities: async (modelId) => {
      queried.push(modelId);
      return { hasImageGeneration: modelId.includes("image") };
    },
  });

  assert.equal(resolved, "openai/gpt-4.1-mini");
  assert.deepEqual(queried, [
    "openai/gpt-image-2",
    "openai/gpt-4.1-mini",
  ]);

  for (const selectedCapabilities of [
    { hasVideoGeneration: true },
    { hasAudioOutput: true },
  ]) {
    const mediaResolved = await resolveTextAncillaryModel({
      selectedModel: "example/media-model",
      defaultModel: "openai/gpt-4.1-mini",
      feature: "Memory extraction",
      getCapabilities: async (modelId) =>
        modelId === "example/media-model" ? selectedCapabilities : {},
    });
    assert.equal(mediaResolved, "openai/gpt-4.1-mini");
  }

  const missingSelection = await resolveTextAncillaryModel({
    selectedModel: "example/pruned-image-model",
    defaultModel: "openai/gpt-4.1-mini",
    feature: "Memory import",
    getCapabilities: async () => null,
  });
  assert.equal(missingSelection, "openai/gpt-4.1-mini");

  await assert.rejects(
    resolveTextAncillaryModel({
      selectedModel: "example/default-image",
      defaultModel: "example/default-image",
      feature: "Memory extraction",
      getCapabilities: async () => ({ hasImageGeneration: true }),
    }),
    (error: unknown) =>
      error instanceof ConvexError &&
      error.data.code === "MEDIA_MODEL_UNSUPPORTED_FOR_TEXT",
  );
});
