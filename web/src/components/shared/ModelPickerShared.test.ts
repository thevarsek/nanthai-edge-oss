import { describe, expect, it } from "vitest";
import {
  filterAndSortModels,
  isProviderAllowedForGoogle,
  matchesFilter,
  modelSupportsVisionInput,
  sortMetric,
  type CapFilter,
  toggleCapFilter,
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

  it("sorts by trend and price fallbacks across video, image, text, and missing metrics", () => {
    const free = model({ modelId: "open/free:free", name: "Free" });
    const videoBySecond = model({
      modelId: "video/second",
      name: "Video Second",
      supportsVideo: true,
      videoPricing: { perVideoSecond: 0.4 },
    });
    const videoBySecond1080p = model({
      modelId: "video/second-1080",
      name: "Video Second 1080",
      supportsVideo: true,
      videoPricing: { perVideoSecond1080p: 0.8 },
    });
    const videoByTokenWithAudio = model({
      modelId: "video/token-audio",
      name: "Video Token Audio",
      supportsVideo: true,
      videoPricing: { perVideoToken: 0.000003 },
    });
    const videoByToken = model({
      modelId: "video/token",
      name: "Video Token",
      supportsVideo: true,
      videoPricing: { perVideoTokenNoAudio: 0.000002 },
    });
    const image = model({
      modelId: "image/model",
      name: "Image",
      supportsImages: true,
      imagePricing: { perImageOutput: 0.0001 },
    });
    const unknown = model({ modelId: "unknown/model", name: "Unknown" });

    expect(sortMetric(model({ openRouterUseCases: [{ category: "coding", returnedRank: 7 }] }), "topThisWeek")).toBe(7);
    expect(sortMetric(model({ openRouterUseCases: [] }), "topThisWeek")).toBeNull();
    expect(sortMetric(free, "price")).toBe(0);
    expect(sortMetric(videoBySecond, "price")).toBe(0.4);
    expect(sortMetric(videoBySecond1080p, "price")).toBe(0.8);
    expect(sortMetric(videoByTokenWithAudio, "price")).toBe(3);
    expect(sortMetric(videoByToken, "price")).toBe(2);
    expect(sortMetric(image, "price")).toBeCloseTo(0.4096);
    expect(sortMetric(unknown, "price")).toBeNull();

    expect(filterAndSortModels([unknown, videoByToken, free], "", "price", new Set()).map((m) => m.name))
      .toEqual(["Free", "Video Token", "Unknown"]);
  });

  it("filters by provider search and keeps free filters mutually exclusive", () => {
    const freeSet = toggleCapFilter(new Set<CapFilter>(["excludeFree"]), "free");
    expect([...freeSet]).toEqual(["free"]);
    expect([...toggleCapFilter(freeSet, "free")]).toEqual([]);

    const models = [
      model({ modelId: "openai/gpt", name: "GPT", provider: "openai" }),
      model({ modelId: "anthropic/claude", name: "Claude", provider: "anthropic" }),
    ];

    expect(filterAndSortModels(models, "anthropic", "recommended", new Set()).map((m) => m.name))
      .toEqual(["Claude"]);
  });
});
