import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatDefaultsMediaModelPickerRow } from "./ChatDefaultsMediaModelPickerRow";

const models = [
  {
    modelId: "image/default",
    name: "Canvas One",
    generationZdrCapabilities: { image: false, music: false, speech: false, video: false },
  },
];

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { type?: string }) => options?.type ? `${key}:${options.type}` : key,
  }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useModelSummaries: () => models,
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span>logo-{modelId}</span>,
}));

vi.mock("@/components/shared/ModelPicker", () => ({
  ModelPicker: ({ generationKind, onSelect, onClose }: {
    generationKind: string;
    onSelect: (modelId: string) => void;
    onClose: () => void;
  }) => (
    <div data-testid="generation-model-picker" data-generation-kind={generationKind}>
      <button onClick={() => { onSelect(`${generationKind}/selected`); onClose(); }}>
        choose-model
      </button>
    </div>
  ),
}));

describe("ChatDefaultsMediaModelPickerRow", () => {
  it("shows the resolved model and persists a new selection", () => {
    const onChange = vi.fn();
    render(
      <ChatDefaultsMediaModelPickerRow
        generationKind="image"
        preferenceKey="defaultImageGenerationModelId"
        selectedModelId="image/default"
        label="Image Generation"
        zdrEnabled={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Canvas One")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Image Generation: Canvas One" }));
    expect(screen.getByTestId("generation-model-picker")).toHaveAttribute("data-generation-kind", "image");
    fireEvent.click(screen.getByText("choose-model"));
    expect(onChange).toHaveBeenCalledWith({ defaultImageGenerationModelId: "image/selected" });
  });

  it("marks a saved model unavailable when its generation endpoint cannot enforce ZDR", () => {
    render(
      <ChatDefaultsMediaModelPickerRow
        generationKind="image"
        preferenceKey="defaultImageGenerationModelId"
        selectedModelId="image/default"
        label="Image Generation"
        zdrEnabled
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByText("unavailable_with_zdr")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Image Generation: Canvas One" }))
      .toHaveAccessibleDescription("unavailable_with_zdr");
  });
});
