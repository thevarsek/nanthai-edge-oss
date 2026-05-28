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

  it("filters, resets, blocks ZDR-disabled rows, and keeps info-sheet clicks separate from selection", () => {
    mockState.prefs = { zdrEnabled: true };
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

  it("routes wizard recommendations through the picker selection contract", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ModelPicker selectedModelId="" onSelect={onSelect} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /help me choose/i }));
    fireEvent.click(screen.getByRole("button", { name: /coding/i }));
    fireEvent.click(screen.getByRole("button", { name: /speed/i }));

    expect(screen.getByText("Best for Coding")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Haiku/ }));

    expect(onSelect).toHaveBeenCalledWith("anthropic/haiku");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
