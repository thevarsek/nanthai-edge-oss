import assert from "node:assert/strict";
import test from "node:test";
import {
  projectGenerationCapabilities,
  projectGenerationZdrCapabilities,
} from "../models/generation_capabilities";

test("generation capabilities distinguish music, speech, image, and video", () => {
  assert.deepEqual(projectGenerationCapabilities({
    modelId: "google/lyria-3-clip-preview",
    architecture: { modality: "text+image->text+audio" },
  }), { image: false, music: true, speech: false, video: false });
  assert.deepEqual(projectGenerationCapabilities({
    modelId: "deepgram/aura-2",
    architecture: { modality: "text->speech" },
  }), { image: false, music: false, speech: true, video: false });
  assert.deepEqual(projectGenerationCapabilities({
    modelId: "openai/gpt-audio-mini",
    architecture: { modality: "text+audio->text+audio" },
  }), { image: false, music: false, speech: false, video: false });
});

test("ZDR generation enables only dedicated endpoint types with documented ZDR routing", () => {
  assert.deepEqual(projectGenerationZdrCapabilities({
    modelId: "bytedance-seed/seedream-4.5",
    supportsImages: true,
    hasZdrEndpoint: true,
  }), { image: false, music: false, speech: false, video: false });
  assert.deepEqual(projectGenerationZdrCapabilities({
    modelId: "deepgram/aura-2",
    architecture: { modality: "text->speech" },
    hasZdrEndpoint: true,
  }), { image: false, music: false, speech: false, video: false });
  assert.deepEqual(projectGenerationZdrCapabilities({
    modelId: "future/video",
    supportsVideo: true,
    hasZdrEndpoint: true,
  }), { image: false, music: false, speech: false, video: false });
});
