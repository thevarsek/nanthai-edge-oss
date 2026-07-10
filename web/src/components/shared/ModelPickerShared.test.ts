import { describe, expect, it } from "vitest";
import {
  filterAndSortModels,
  isProviderAllowedForGoogle,
  matchesFilter,
  modelHasTextOnlyOutput,
  modelIsZdrEligible,
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

  it("treats dedicated image editing references as image input capability", () => {
    const imageEditor = model({
      modelId: "openai/gpt-image-2",
      supportsImages: true,
      architecture: { modality: "text->image" },
      mediaCapabilities: {
        image: {
          aspectRatios: [],
          resolutions: [],
          sizes: [],
          qualities: [],
          backgrounds: [],
          outputFormats: [],
          maxInputReferences: 4,
          supportsStreaming: false,
        },
      },
    });

    expect(modelSupportsVisionInput(imageEditor)).toBe(true);
    expect(matchesFilter(imageEditor, "vision" satisfies CapFilter)).toBe(true);
  });

  it("allows Google Workspace models by OpenRouter slug when provider label differs", () => {
    expect(isProviderAllowedForGoogle("google/gemini-2.5-pro", "google-ai-studio")).toBe(true);
    expect(isProviderAllowedForGoogle("meta-llama/llama-4", "google-ai-studio")).toBe(false);
  });

  it("treats every image or video output model as unsafe for text-only pickers", () => {
    expect(modelHasTextOnlyOutput(model({ architecture: { modality: "text->text" } }))).toBe(true);
    expect(modelHasTextOnlyOutput(model({
      supportsImages: true,
      architecture: { modality: "text->text+image" },
    }))).toBe(false);
    expect(modelHasTextOnlyOutput(model({ architecture: { modality: "text->image" } }))).toBe(false);
    expect(modelHasTextOnlyOutput(model({ supportsVideo: true }))).toBe(false);
    expect(modelHasTextOnlyOutput(model({ architecture: { modality: "text->audio" } }))).toBe(false);
    expect(modelHasTextOnlyOutput(model({ architecture: undefined }))).toBe(true);
  });

  it("never treats image output as ZDR eligible from a cached endpoint flag", () => {
    expect(modelIsZdrEligible(model({ hasZdrEndpoint: true }))).toBe(true);
    expect(modelIsZdrEligible(model({ hasZdrEndpoint: false }))).toBe(false);
    expect(modelIsZdrEligible(model({ supportsImages: true, hasZdrEndpoint: true }))).toBe(false);
    expect(modelIsZdrEligible(model({
      architecture: { modality: "text->text+image" },
      hasZdrEndpoint: true,
    }))).toBe(false);
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
    const imageDirect = model({
      modelId: "image/direct",
      name: "Image Direct",
      supportsImages: true,
      imagePricing: { perImage: 0.04, perMegapixel: 0.01, perImageOutput: 0.0001 },
    });
    const imageMegapixel = model({
      modelId: "image/megapixel",
      name: "Image Megapixel",
      supportsImages: true,
      imagePricing: { perMegapixel: 0.06, perImageOutput: 0.0001 },
    });
    const imageToken = model({
      modelId: "image/token",
      name: "Image Token",
      supportsImages: true,
      imagePricing: { perImageOutput: 0.00002, perImageToken: 0.00001 },
    });
    const unknown = model({ modelId: "unknown/model", name: "Unknown" });

    expect(sortMetric(model({ openRouterUseCases: [{ category: "coding", returnedRank: 7 }] }), "topThisWeek")).toBe(7);
    expect(sortMetric(model({ openRouterUseCases: [] }), "topThisWeek")).toBeNull();
    expect(sortMetric(free, "price")).toBe(0);
    expect(sortMetric(videoBySecond, "price")).toBe(0.4);
    expect(sortMetric(videoBySecond1080p, "price")).toBe(0.8);
    expect(sortMetric(videoByTokenWithAudio, "price")).toBe(3);
    expect(sortMetric(videoByToken, "price")).toBe(2);
    expect(sortMetric(imageDirect, "price")).toBe(0.04);
    expect(sortMetric(imageMegapixel, "price")).toBe(0.06);
    expect(sortMetric(imageToken, "price")).toBeCloseTo(0.08192);
    expect(sortMetric(unknown, "price")).toBeNull();

    expect(filterAndSortModels([unknown, videoByToken, free], "", "price", new Set()).map((m) => m.name))
      .toEqual(["Free", "Video Token", "Unknown"]);
    expect(filterAndSortModels(
      [imageToken, imageMegapixel, imageDirect],
      "",
      "price",
      new Set(),
    ).map((m) => m.name)).toEqual(["Image Direct", "Image Megapixel", "Image Token"]);
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
