import { describe, expect, it } from "vitest";
import {
  isProviderAllowedForGoogle,
  matchesFilter,
  modelSupportsVisionInput,
  type CapFilter,
} from "./ModelPickerShared";
import type { ModelSummary } from "./ModelPickerHelpers";

function model(overrides: Partial<ModelSummary>): ModelSummary {
  return {
    modelId: "openai/gpt-4.1",
    name: "Test Model",
    ...overrides,
  };
}

describe("ModelPickerShared", () => {
  it("treats image-to-video models as vision-capable", () => {
    const imageToVideo = model({
      modelId: "google/veo-image",
      supportsVideo: true,
      supportedFrameImages: ["first_frame"],
      architecture: { modality: "text+image->video" },
    });
    const textToVideo = model({
      modelId: "google/veo-text",
      supportsVideo: true,
      supportedFrameImages: [],
      architecture: { modality: "text->video" },
    });

    expect(modelSupportsVisionInput(imageToVideo)).toBe(true);
    expect(matchesFilter(imageToVideo, "vision" satisfies CapFilter)).toBe(true);
    expect(modelSupportsVisionInput(textToVideo)).toBe(false);
    expect(matchesFilter(textToVideo, "vision" satisfies CapFilter)).toBe(false);
  });

  it("allows Google Workspace models by OpenRouter slug when provider label differs", () => {
    expect(isProviderAllowedForGoogle("google/gemini-2.5-pro", "google-ai-studio")).toBe(true);
    expect(isProviderAllowedForGoogle("meta-llama/llama-4", "google-ai-studio")).toBe(false);
  });
});
