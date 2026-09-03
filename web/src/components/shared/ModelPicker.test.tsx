import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker";
import type { ModelSummary } from "./ModelPickerHelpers";

const mockState = vi.hoisted(() => ({
  models: [] as ModelSummary[],
  prefs: { zdrEnabled: false },
}));

vi.mock("@/hooks/useSharedData", () => ({
  useModelSummaries: () => mockState.models,
  useSharedData: () => ({ prefs: mockState.prefs }),
}));

vi.mock("./ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span data-testid="provider-logo">{modelId}</span>,
}));

vi.mock("@/components/shared/ModelSettingsEditor", () => ({
  ModelSettingsEditor: ({ modelId }: { modelId: string }) => <div>settings-{modelId}</div>,
}));

function seedModels() {
  mockState.models = [
    {
      modelId: "openai/gpt-4o",
      name: "GPT 4o",
      provider: "openai",
      supportsTools: true,
      hasZdrEndpoint: true,
      inputPricePer1M: 2,
      outputPricePer1M: 8,
      contextLength: 128000,
      derivedGuidance: { primaryLabel: "recommended.best", scores: { recommended: 0.9, coding: 0.8, fast: 0.4, value: 0.3 } },
      openRouterUseCases: [{ category: "programming", returnedRank: 2 }],
    },
    {
      modelId: "anthropic/haiku",
      name: "Haiku",
      provider: "anthropic",
      supportsTools: false,
      hasZdrEndpoint: true,
      inputPricePer1M: 0.1,
      outputPricePer1M: 0.2,
      derivedGuidance: { scores: { recommended: 0.3, coding: 0.2, fast: 0.95, value: 0.8 } },
    },
    {
      modelId: "image/free:free",
      name: "Free Image",
      provider: "imageco",
      supportsImages: true,
      isFree: true,
      hasZdrEndpoint: false,
      imagePricing: { perImageToken: 0.0002 },
      derivedGuidance: { scores: { recommended: 0.1, image: 0.9 } },
    },
  ];
}

beforeEach(() => {
  seedModels();
  mockState.prefs = { zdrEnabled: false };
});

describe("ModelPicker", () => {
  it("keeps the model list as the bounded scroll owner", () => {
    render(<ModelPicker selectedModelId="" onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByTestId("model-picker-list")).toHaveClass(
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
    );
  });

  it("pins the selected model when search filters it out and clears search without selecting", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ModelPicker selectedModelId="openai/gpt-4o" onSelect={onSelect} onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText(/search models/i), { target: { value: "haiku" } });

    const selectedSection = screen.getByText("Selected").parentElement!;
    expect(within(selectedSection).getByText("GPT 4o")).toBeInTheDocument();
    expect(screen.getByText("Haiku")).toBeInTheDocument();

    fireEvent.click(screen.getByPlaceholderText(/search models/i).parentElement!.querySelector("button")!);
    expect(screen.getByText("Free Image")).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("excludes image and video outputs from opt-in text-only pickers", () => {
    mockState.models.push(
      {
        modelId: "image/hybrid",
        name: "Hybrid Image",
        supportsImages: true,
        architecture: { modality: "text->text+image" },
      },
      {
        modelId: "video/model",
        name: "Video Model",
        supportsVideo: true,
        architecture: { modality: "text->video" },
      },
    );

    render(
      <ModelPicker
        selectedModelId="image/free:free"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        textOutputOnly
      />,
    );

    expect(screen.getByText("GPT 4o")).toBeInTheDocument();
    expect(screen.getByText("Haiku")).toBeInTheDocument();
    expect(screen.queryByText("Free Image")).not.toBeInTheDocument();
    expect(screen.queryByText("Hybrid Image")).not.toBeInTheDocument();
    expect(screen.queryByText("Video Model")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected")).not.toBeInTheDocument();
  });

  it("shows only models matching the requested generation capability", () => {
    mockState.models = [
      { modelId: "image/model", name: "Image Model", generationCapabilities: { image: true, music: false, speech: false, video: false } },
      { modelId: "music/model", name: "Music Model", generationCapabilities: { image: false, music: true, speech: false, video: false } },
      { modelId: "speech/model", name: "Speech Model", generationCapabilities: { image: false, music: false, speech: true, video: false } },
      { modelId: "video/model", name: "Video Model", generationCapabilities: { image: false, music: false, speech: false, video: true } },
    ];
    const commonProps = { selectedModelId: "", onSelect: vi.fn(), onClose: vi.fn() };
    const { rerender } = render(<ModelPicker {...commonProps} generationKind="image" />);

    expect(screen.getByText("Image Model")).toBeInTheDocument();
    expect(screen.queryByText("Music Model")).not.toBeInTheDocument();
    expect(screen.queryByText(/help me choose/i)).not.toBeInTheDocument();

    rerender(<ModelPicker {...commonProps} generationKind="music" />);
    expect(screen.getByText("Music Model")).toBeInTheDocument();
    expect(screen.queryByText("Image Model")).not.toBeInTheDocument();

    rerender(<ModelPicker {...commonProps} generationKind="speech" />);
    expect(screen.getByText("Speech Model")).toBeInTheDocument();

    rerender(<ModelPicker {...commonProps} generationKind="video" />);
    expect(screen.getByText("Video Model")).toBeInTheDocument();
  });

  it("keeps incompatible generation models visible but disabled while ZDR is enabled", () => {
    mockState.prefs = { zdrEnabled: true };
    mockState.models = [
      {
        modelId: "speech/non-zdr",
        name: "Standard Voice",
        generationCapabilities: { image: false, music: false, speech: true, video: false },
        generationZdrCapabilities: { image: false, music: false, speech: false, video: false },
      },
      {
        modelId: "speech/zdr",
        name: "ZDR Voice",
        generationCapabilities: { image: false, music: false, speech: true, video: false },
        generationZdrCapabilities: { image: false, music: false, speech: true, video: false },
      },
    ];

    render(
      <ModelPicker
        selectedModelId="speech/non-zdr"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        generationKind="speech"
      />,
    );

    expect(screen.getByText("ZDR Voice")).toBeInTheDocument();
    expect(screen.getByText("Standard Voice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Standard Voice" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(/doesn't support Zero Data Retention/i)).toBeInTheDocument();
    expect(screen.queryByText("Selected")).not.toBeInTheDocument();
  });

  it("filters, resets, blocks ZDR-disabled rows, and keeps info-sheet clicks separate from selection", () => {
    mockState.prefs = { zdrEnabled: true };
    const imageModel = mockState.models.find((model) => model.modelId === "image/free:free");
    if (imageModel) imageModel.hasZdrEndpoint = true;
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ModelPicker selectedModelId="" onSelect={onSelect} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /tool use/i }));
    expect(screen.getByText("GPT 4o")).toBeInTheDocument();
    expect(screen.queryByText("Haiku")).not.toBeInTheDocument();
    expect(screen.queryByText("Free Image")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reset/i }));
    fireEvent.click(screen.getByText("Free Image"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText(/doesn't support Zero Data Retention/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("Model info")[0]!);
    expect(screen.getByRole("heading", { name: "GPT 4o" })).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects enabled model rows with keyboard activation", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ModelPicker selectedModelId="" onSelect={onSelect} onClose={onClose} />);

    const row = screen.getByRole("button", { name: "GPT 4o" });
    expect(row).toHaveAttribute("tabindex", "0");

    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("openai/gpt-4o");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps ZDR-disabled model rows out of keyboard selection", () => {
    mockState.prefs = { zdrEnabled: true };
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ModelPicker selectedModelId="" onSelect={onSelect} onClose={onClose} />);

    const row = screen.getByRole("button", { name: "Free Image" });
    expect(row).toHaveAttribute("aria-disabled", "true");
    expect(row).not.toHaveAttribute("tabindex");

    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adds the compact media summary to the visible row and accessible name", () => {
    const imageModel = mockState.models.find((model) => model.modelId === "image/free:free");
    if (imageModel) {
      imageModel.mediaCapabilities = {
        image: {
          countMin: 1,
          countMax: 4,
          aspectRatios: [],
          resolutions: ["2K"],
          sizes: [],
          qualities: [],
          backgrounds: [],
          outputFormats: [],
          maxInputReferences: 2,
          supportsStreaming: false,
        },
      };
    }

    render(<ModelPicker selectedModelId="" onSelect={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText("Up to 4 images • Image editing • 2K")).toBeInTheDocument();
    expect(screen.getByRole("button", {
      name: "Free Image. Up to 4 images, Image editing, 2K",
    })).toBeInTheDocument();
  });

  it("routes wizard recommendations through the picker selection contract", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ModelPicker selectedModelId="" onSelect={onSelect} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /help me choose/i }));
    fireEvent.click(screen.getByRole("button", { name: /coding/i }));
    fireEvent.click(screen.getByRole("button", { name: /speed/i }));

    expect(screen.getByText("Best for Coding")).toBeInTheDocument();
    const wizardHaikuButton = screen
      .getAllByRole("button", { name: /Haiku/ })
      .find((element) => element.tagName === "BUTTON");
    expect(wizardHaikuButton).toBeDefined();
    fireEvent.click(wizardHaikuButton!);

    expect(onSelect).toHaveBeenCalledWith("anthropic/haiku");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
