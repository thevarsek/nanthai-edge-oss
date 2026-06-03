import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelInfoSheet, ModelWizard, type ModelSummary } from "./ModelPickerHelpers";
import {
  formatImagePrice,
  formatPrice,
  formatVideoPrice,
  listRowPriceLabel,
  wizardScore,
} from "./ModelPickerHelpers.utils";
import { selectWizardResults } from "./ModelPickerWizardResults";

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

function codingModel({
  modelId,
  name,
  score,
  hasZdrEndpoint,
}: {
  modelId: string;
  name: string;
  score: number;
  hasZdrEndpoint: boolean;
}): ModelSummary {
  return {
    modelId,
    name,
    provider: "provider",
    hasZdrEndpoint,
    derivedGuidance: { scores: { coding: score, recommended: score, fast: score, value: score } },
    openRouterUseCases: [{ category: "programming", returnedRank: 1 }],
  };
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

  it("covers fallback score paths for missing scores, ranked domains, and priorities", () => {
    expect(wizardScore({}, "everyday", "quality")).toBe(0);

    const scoresOnly = {
      derivedGuidance: { scores: { recommended: 0.4, coding: 0.8, research: 0.7, fast: 0.9, value: 0.6 } },
    };
    expect(wizardScore(scoresOnly, "coding", "fastest")).toBeCloseTo(0.78);
    expect(wizardScore(scoresOnly, "research", "value")).toBeCloseTo(0.57);
    expect(wizardScore(scoresOnly, "everyday", "quality")).toBe(0.4);

    const rankedEveryday = {
      derivedGuidance: { scores: { recommended: 0.5, fast: 0.6, value: 0.2 } },
      openRouterUseCases: [{ category: "trivia", returnedRank: 11 }],
    };
    expect(wizardScore(rankedEveryday, "everyday", "quality")).toBeCloseTo(0.78);
    expect(wizardScore(rankedEveryday, "everyday", "fastest")).toBeCloseTo(0.73);

    const rankedCoding = {
      derivedGuidance: { scores: { recommended: 0.4, coding: 0.9, fast: 0.5 } },
      openRouterUseCases: [{ category: "programming", returnedRank: 1 }],
    };
    expect(wizardScore(rankedCoding, "coding", "quality")).toBeCloseTo(0.94);
  });
});

describe("ModelWizard", () => {
  it("keeps selectable recommendations visible when blocked models score higher", () => {
    const models = [
      codingModel({ modelId: "blocked/top", name: "Blocked Top", score: 1, hasZdrEndpoint: false }),
      codingModel({ modelId: "blocked/mid", name: "Blocked Mid", score: 0.9, hasZdrEndpoint: false }),
      codingModel({ modelId: "blocked/low", name: "Blocked Low", score: 0.8, hasZdrEndpoint: false }),
      codingModel({ modelId: "allowed/coder", name: "Allowed Coding", score: 0.4, hasZdrEndpoint: true }),
    ];

    const selected = selectWizardResults({
      models,
      task: "coding",
      priority: "quality",
      zdrEnforced: true,
    });

    expect(selected.map((model) => model.modelId)).toEqual(["allowed/coder", "blocked/top", "blocked/mid"]);
  });

  it("renders lower-scored selectable recommendations ahead of blocked recommendations", () => {
    const onSelect = vi.fn();
    render(
      <ModelWizard
        models={[
          codingModel({ modelId: "blocked/top", name: "Blocked Top", score: 1, hasZdrEndpoint: false }),
          codingModel({ modelId: "blocked/mid", name: "Blocked Mid", score: 0.9, hasZdrEndpoint: false }),
          codingModel({ modelId: "blocked/low", name: "Blocked Low", score: 0.8, hasZdrEndpoint: false }),
          codingModel({ modelId: "allowed/coder", name: "Allowed Coding", score: 0.4, hasZdrEndpoint: true }),
        ]}
        onSelect={onSelect}
        onClose={vi.fn()}
        zdrEnforced
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Coding/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quality/i }));

    expect(screen.getByText("Allowed Coding")).toBeInTheDocument();
    expect(screen.getByText("Blocked Top")).toBeInTheDocument();
    expect(screen.getAllByText(/doesn't support Zero Data Retention/i)).not.toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /Allowed Coding/i }));
    expect(onSelect).toHaveBeenCalledWith("allowed/coder");
  });

  it("does not submit ancestor forms when selecting wizard controls", () => {
    const onSelect = vi.fn();
    const onSubmit = vi.fn();
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <ModelWizard
          models={[codingModel({
            modelId: "allowed/coder",
            name: "Allowed Coding",
            score: 0.8,
            hasZdrEndpoint: true,
          })]}
          onSelect={onSelect}
          onClose={vi.fn()}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Coding/i }));
    fireEvent.click(screen.getByRole("button", { name: /Quality/i }));
    fireEvent.click(screen.getByRole("button", { name: /Allowed Coding/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith("allowed/coder");
  });

  it("renders blocked scored recommendations with their disabled reason", () => {
    const onSelect = vi.fn();
    render(
      <ModelWizard
        models={[{
          modelId: "blocked/coder",
          name: "Blocked Coding",
          provider: "blocked",
          hasZdrEndpoint: false,
          derivedGuidance: { scores: { coding: 0.9, fast: 0.8, recommended: 0.4 } },
          openRouterUseCases: [{ category: "programming", returnedRank: 1 }],
        } as ModelSummary]}
        onSelect={onSelect}
        onClose={vi.fn()}
        zdrEnforced
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Coding/i }));
    fireEvent.click(screen.getByRole("button", { name: /Speed/i }));

    expect(screen.queryByText(/No guidance data available/i)).not.toBeInTheDocument();
    expect(screen.getByText("Blocked Coding")).toBeInTheDocument();
    expect(screen.getByText(/doesn't support Zero Data Retention/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Blocked Coding/i }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("model picker price helpers", () => {
  it("formats text, image, and video prices across display thresholds", () => {
    expect(formatPrice()).toBe("—");
    expect(formatPrice(0)).toBe("$0.00/M");
    expect(formatPrice(0.005)).toBe("$0.0050/M");
    expect(formatPrice(0.25)).toBe("$0.250/M");
    expect(formatPrice(2)).toBe("$2.00/M");

    expect(formatImagePrice()).toBe("—");
    expect(formatImagePrice(0)).toBe("$0.00/MP");
    expect(formatImagePrice(0.000001)).toBe("$0.0041/MP");
    expect(formatImagePrice(0.0001)).toBe("$0.410/MP");
    expect(formatImagePrice(0.001)).toBe("$4.10/MP");

    expect(formatVideoPrice()).toBe("—");
    expect(formatVideoPrice(0, "sec")).toBe("$0.00");
    expect(formatVideoPrice(0.00001, "sec")).toBe("$1.0e-5/sec");
    expect(formatVideoPrice(0.005, "sec")).toBe("$0.005000/sec");
    expect(formatVideoPrice(0.25, "sec")).toBe("$0.2500/sec");
    expect(formatVideoPrice(2, "sec")).toBe("$2.00/sec");
    expect(formatVideoPrice(0.000002, "tok")).toBe("$2.00/M tok");
    expect(formatVideoPrice(0.5)).toBe("$0.5000/unit");
  });

  it("chooses compact list-row pricing by modality and skips free or unknown pricing", () => {
    expect(listRowPriceLabel({ modelId: "open/free:free" })).toBeNull();
    expect(listRowPriceLabel({ modelId: "open/zero", inputPricePer1M: 0, outputPricePer1M: 0 })).toBeNull();
    expect(listRowPriceLabel({ modelId: "open/text", inputPricePer1M: 0.1, outputPricePer1M: 0.2 })).toBe("$0.300/M");

    expect(listRowPriceLabel({
      modelId: "video/sec",
      supportsVideo: true,
      videoPricing: { perVideoSecond: 0.12, perVideoSecond1080p: 0.2 },
    })).toBe("$0.1200/sec");
    expect(listRowPriceLabel({
      modelId: "video/sec-1080",
      supportsVideo: true,
      videoPricing: { perVideoSecond1080p: 0.2 },
    })).toBe("$0.2000/sec");
    expect(listRowPriceLabel({
      modelId: "video/tok",
      supportsVideo: true,
      videoPricing: { perVideoToken: 0.000003 },
    })).toBe("$3.00/M tok");
    expect(listRowPriceLabel({
      modelId: "video/tok-no-audio",
      supportsVideo: true,
      videoPricing: { perVideoTokenNoAudio: 0.000004 },
    })).toBe("$4.00/M tok");

    expect(listRowPriceLabel({
      modelId: "image/output",
      supportsImages: true,
      imagePricing: { perImageOutput: 0.0001, perImageToken: 0.001 },
    })).toBe("$0.410/MP");
    expect(listRowPriceLabel({
      modelId: "image/token",
      supportsImages: true,
      imagePricing: { perImageToken: 0.0002 },
    })).toBe("$0.819/MP");
  });
});
