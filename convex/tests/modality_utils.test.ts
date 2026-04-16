import assert from "node:assert/strict";
import test from "node:test";

import {
  getOutputModalityCategory,
  getModelModalityCategory,
  validateSameModality,
} from "../lib/modality_utils";

// =============================================================================
// getOutputModalityCategory — pure function, no DB access
// =============================================================================

test("getOutputModalityCategory returns 'text' for undefined modality", () => {
  assert.equal(getOutputModalityCategory(undefined), "text");
});

test("getOutputModalityCategory returns 'text' for empty string", () => {
  assert.equal(getOutputModalityCategory(""), "text");
});

test("getOutputModalityCategory returns 'text' for text-only output", () => {
  assert.equal(getOutputModalityCategory("text->text"), "text");
});

test("getOutputModalityCategory returns 'text' for text+image output (multimodal text model)", () => {
  // Models like GPT-4o that output both text and images are categorized as text
  assert.equal(getOutputModalityCategory("text+image->text+image"), "text");
});

test("getOutputModalityCategory returns 'image' for image-only output", () => {
  assert.equal(getOutputModalityCategory("text->image"), "image");
});

test("getOutputModalityCategory returns 'image' for text+image input, image-only output", () => {
  assert.equal(getOutputModalityCategory("text+image->image"), "image");
});

test("getOutputModalityCategory returns 'video' for video output", () => {
  assert.equal(getOutputModalityCategory("text+image->video"), "video");
});

test("getOutputModalityCategory returns 'video' for text+video output", () => {
  // Video takes priority over text in the output
  assert.equal(getOutputModalityCategory("text->text+video"), "video");
});

test("getOutputModalityCategory returns 'video' for image+video output", () => {
  assert.equal(getOutputModalityCategory("text+image->image+video"), "video");
});

test("getOutputModalityCategory returns 'text' when no arrow present", () => {
  // Edge case: malformed modality string without "->"
  assert.equal(getOutputModalityCategory("text"), "text");
});

test("getOutputModalityCategory returns 'text' for audio-only output", () => {
  assert.equal(getOutputModalityCategory("text->audio"), "text");
});

test("getOutputModalityCategory returns 'text' for text+audio output", () => {
  assert.equal(getOutputModalityCategory("text->text+audio"), "text");
});

// =============================================================================
// getModelModalityCategory — requires mock DB context
// =============================================================================

function buildModelDb(models: Record<string, any>) {
  return {
    db: {
      query: () => ({
        withIndex: (_name: string, fn: (q: any) => any) => {
          const captured: Record<string, string> = {};
          const q = { eq: (field: string, value: string) => { captured[field] = value; return q; } };
          fn(q);
          return {
            first: async () => models[captured.modelId] ?? null,
          };
        },
      }),
    },
  } as any;
}

test("getModelModalityCategory returns 'text' for unknown model", async () => {
  const ctx = buildModelDb({});
  assert.equal(await getModelModalityCategory(ctx, "nonexistent/model"), "text");
});

test("getModelModalityCategory returns 'video' when supportsVideo is true", async () => {
  const ctx = buildModelDb({
    "bytedance/seedance-2.0": {
      supportsVideo: true,
      architecture: { modality: "text+image->video" },
    },
  });
  assert.equal(await getModelModalityCategory(ctx, "bytedance/seedance-2.0"), "video");
});

test("getModelModalityCategory returns 'image' for pure image gen model", async () => {
  const ctx = buildModelDb({
    "openai/dall-e-3": {
      supportsImages: true,
      architecture: { modality: "text->image" },
    },
  });
  assert.equal(await getModelModalityCategory(ctx, "openai/dall-e-3"), "image");
});

test("getModelModalityCategory returns 'text' for multimodal text+image model (GPT-4o style)", async () => {
  // GPT-4o supports images but outputs text+image — categorized as text
  const ctx = buildModelDb({
    "openai/gpt-4o": {
      supportsImages: true,
      architecture: { modality: "text+image->text+image" },
    },
  });
  assert.equal(await getModelModalityCategory(ctx, "openai/gpt-4o"), "text");
});

test("getModelModalityCategory returns 'text' for model with no architecture", async () => {
  const ctx = buildModelDb({
    "some/model": {},
  });
  assert.equal(await getModelModalityCategory(ctx, "some/model"), "text");
});

test("getModelModalityCategory prefers supportsVideo flag over modality string", async () => {
  // Even if modality says text, supportsVideo flag wins
  const ctx = buildModelDb({
    "test/video-model": {
      supportsVideo: true,
      architecture: { modality: "text->text" },
    },
  });
  assert.equal(await getModelModalityCategory(ctx, "test/video-model"), "video");
});

test("getModelModalityCategory returns 'text' when supportsImages is true but output includes text", async () => {
  const ctx = buildModelDb({
    "anthropic/claude-3.5-sonnet": {
      supportsImages: false,
      architecture: { modality: "text+image->text" },
    },
  });
  assert.equal(await getModelModalityCategory(ctx, "anthropic/claude-3.5-sonnet"), "text");
});

// =============================================================================
// validateSameModality — validates groups of model IDs
// =============================================================================

test("validateSameModality passes for empty array", async () => {
  const ctx = buildModelDb({});
  assert.equal(await validateSameModality(ctx, []), "text");
});

test("validateSameModality passes for single model", async () => {
  const ctx = buildModelDb({
    "openai/dall-e-3": {
      supportsImages: true,
      architecture: { modality: "text->image" },
    },
  });
  assert.equal(await validateSameModality(ctx, ["openai/dall-e-3"]), "image");
});

test("validateSameModality passes for two text models", async () => {
  const ctx = buildModelDb({
    "openai/gpt-4o": { architecture: { modality: "text->text" } },
    "anthropic/claude-3.5-sonnet": { architecture: { modality: "text+image->text" } },
  });
  assert.equal(
    await validateSameModality(ctx, ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"]),
    "text",
  );
});

test("validateSameModality passes for two image models", async () => {
  const ctx = buildModelDb({
    "openai/dall-e-3": { supportsImages: true, architecture: { modality: "text->image" } },
    "stability/sdxl": { supportsImages: true, architecture: { modality: "text+image->image" } },
  });
  assert.equal(
    await validateSameModality(ctx, ["openai/dall-e-3", "stability/sdxl"]),
    "image",
  );
});

test("validateSameModality passes for two video models", async () => {
  const ctx = buildModelDb({
    "bytedance/seedance-2.0": { supportsVideo: true, architecture: { modality: "text+image->video" } },
    "google/veo-3.1": { supportsVideo: true, architecture: { modality: "text+image->video" } },
  });
  assert.equal(
    await validateSameModality(ctx, ["bytedance/seedance-2.0", "google/veo-3.1"]),
    "video",
  );
});

test("validateSameModality throws for text + image mix", async () => {
  const ctx = buildModelDb({
    "openai/gpt-4o": { architecture: { modality: "text->text" } },
    "openai/dall-e-3": { supportsImages: true, architecture: { modality: "text->image" } },
  });
  await assert.rejects(
    validateSameModality(ctx, ["openai/gpt-4o", "openai/dall-e-3"]),
    (err: Error) => {
      assert.ok(err.message.includes("cannot be mixed"));
      assert.ok(err.message.includes("Image generation"));
      assert.ok(err.message.includes("Text"));
      return true;
    },
  );
});

test("validateSameModality throws for text + video mix", async () => {
  const ctx = buildModelDb({
    "openai/gpt-4o": { architecture: { modality: "text->text" } },
    "bytedance/seedance-2.0": { supportsVideo: true, architecture: { modality: "text+image->video" } },
  });
  await assert.rejects(
    validateSameModality(ctx, ["openai/gpt-4o", "bytedance/seedance-2.0"]),
    (err: Error) => {
      assert.ok(err.message.includes("cannot be mixed"));
      assert.ok(err.message.includes("Video generation"));
      assert.ok(err.message.includes("Text"));
      return true;
    },
  );
});

test("validateSameModality throws for image + video mix", async () => {
  const ctx = buildModelDb({
    "openai/dall-e-3": { supportsImages: true, architecture: { modality: "text->image" } },
    "bytedance/seedance-2.0": { supportsVideo: true, architecture: { modality: "text+image->video" } },
  });
  await assert.rejects(
    validateSameModality(ctx, ["openai/dall-e-3", "bytedance/seedance-2.0"]),
    (err: Error) => {
      assert.ok(err.message.includes("cannot be mixed"));
      return true;
    },
  );
});

test("validateSameModality throws for three models where one differs", async () => {
  const ctx = buildModelDb({
    "openai/gpt-4o": { architecture: { modality: "text->text" } },
    "anthropic/claude-3.5-sonnet": { architecture: { modality: "text+image->text" } },
    "openai/dall-e-3": { supportsImages: true, architecture: { modality: "text->image" } },
  });
  await assert.rejects(
    validateSameModality(ctx, ["openai/gpt-4o", "anthropic/claude-3.5-sonnet", "openai/dall-e-3"]),
    (err: Error) => {
      assert.ok(err.message.includes("cannot be mixed"));
      return true;
    },
  );
});

test("validateSameModality treats unknown models as text (safe default)", async () => {
  const ctx = buildModelDb({
    "openai/gpt-4o": { architecture: { modality: "text->text" } },
  });
  // "unknown/model" not in DB → defaults to text → matches gpt-4o
  assert.equal(
    await validateSameModality(ctx, ["openai/gpt-4o", "unknown/model"]),
    "text",
  );
});

test("validateSameModality rejects unknown model paired with video model", async () => {
  const ctx = buildModelDb({
    "bytedance/seedance-2.0": { supportsVideo: true, architecture: { modality: "text+image->video" } },
  });
  // "unknown/model" defaults to text → mismatches video
  await assert.rejects(
    validateSameModality(ctx, ["bytedance/seedance-2.0", "unknown/model"]),
    (err: Error) => {
      assert.ok(err.message.includes("cannot be mixed"));
      return true;
    },
  );
});
