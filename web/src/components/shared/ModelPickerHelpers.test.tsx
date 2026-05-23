import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelInfoSheet, type ModelSummary } from "./ModelPickerHelpers";
import { wizardScore } from "./ModelPickerHelpers.utils";

vi.mock("@/components/shared/ModelSettingsEditor", () => ({
  ModelSettingsEditor: () => null,
}));

function renderSheet(model: Partial<ModelSummary>) {
  render(
    <ModelInfoSheet
      model={{
        modelId: "provider/model",
        name: "Provider Model",
        ...model,
      }}
      onClose={vi.fn()}
    />,
  );
}

describe("ModelInfoSheet pricing", () => {
  it("shows image-token-only pricing as a per-megapixel row", () => {
    renderSheet({
      supportsImages: true,
      imagePricing: { perImageToken: 0.00001 },
    });

    expect(screen.getByText("Per megapixel")).toBeInTheDocument();
    expect(screen.queryByText(/Pricing not yet published/i)).not.toBeInTheDocument();
  });

  it("shows 1080p-only video pricing", () => {
    renderSheet({
      supportsVideo: true,
      videoPricing: { perVideoSecond1080p: 0.18 },
    });

    expect(screen.getByText("Per second (1080p)")).toBeInTheDocument();
    expect(screen.queryByText(/Pricing not yet published/i)).not.toBeInTheDocument();
  });

  it("shows no-audio-only video token pricing", () => {
    renderSheet({
      supportsVideo: true,
      videoPricing: { perVideoTokenNoAudio: 0.000002 },
    });

    expect(screen.getByText("Per token (no audio)")).toBeInTheDocument();
    expect(screen.queryByText(/Pricing not yet published/i)).not.toBeInTheDocument();
  });
});

describe("wizardScore", () => {
  it("uses writing and translation task categories when scoring", () => {
    const marketingModel = {
      modelId: "provider/writer",
      name: "Writer",
      derivedGuidance: { scores: { recommended: 0.5, fast: 0.5, value: 0.5 } },
      openRouterUseCases: [{ category: "marketing", returnedRank: 1 }],
    } as ModelSummary;
    const translationModel = {
      modelId: "provider/translator",
      name: "Translator",
      derivedGuidance: { scores: { recommended: 0.5, fast: 0.5, value: 0.5 } },
      openRouterUseCases: [{ category: "translation", returnedRank: 1 }],
    } as ModelSummary;

    expect(wizardScore(marketingModel, "writing", "quality")).toBeGreaterThan(
      wizardScore(translationModel, "writing", "quality"),
    );
    expect(wizardScore(translationModel, "translation", "quality")).toBeGreaterThan(
      wizardScore(marketingModel, "translation", "quality"),
    );
  });
});
