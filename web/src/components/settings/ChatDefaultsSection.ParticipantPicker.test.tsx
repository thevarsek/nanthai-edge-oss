import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParticipantPicker } from "./ChatDefaultsSection.ParticipantPicker";

let personas: unknown[] = [];
let modelSummaries: unknown[] | undefined = [];

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ personas, prefs: {} }),
  useModelSummaries: () => modelSummaries,
}));

vi.mock("@/components/shared/ModelPickerHelpers", () => ({
  ModelInfoSheet: () => null,
  ModelWizard: ({ onSelect }: { onSelect: (modelId: string) => void }) => (
    <button type="button" onClick={() => onSelect("anthropic/claude")}>
      Pick wizard model
    </button>
  ),
}));

vi.mock("@/components/shared/PersonaInfoSheet", () => ({
  PersonaInfoSheet: () => null,
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName }: { personaName?: string }) => <span>{personaName}</span>,
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span>{modelId}</span>,
}));

describe("ParticipantPicker", () => {
  it("does not show no results while models are still loading", () => {
    personas = [];
    modelSummaries = undefined;

    render(
      <ParticipantPicker
        selectedPersonaId={null}
        selectedModelId="openai/gpt-4o"
        onSelectPersona={vi.fn()}
        onSelectModel={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/loading models/i)).toBeInTheDocument();
    expect(screen.queryByText(/no results/i)).not.toBeInTheDocument();
  });

  it("uses count-aware footer labels", () => {
    personas = [{ _id: "persona_1", displayName: "Guide" }];
    modelSummaries = [{ modelId: "openai/gpt-4o", name: "GPT-4o", provider: "openai" }];

    render(
      <ParticipantPicker
        selectedPersonaId={null}
        selectedModelId="openai/gpt-4o"
        onSelectPersona={vi.fn()}
        onSelectModel={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("1 persona · 1 model")).toBeInTheDocument();
  });

  it("selects personas, models, and wizard recommendations then closes", () => {
    personas = [{ _id: "persona_1", displayName: "Guide" }];
    modelSummaries = [
      { modelId: "openai/gpt-4o", name: "GPT-4o", provider: "openai" },
      { modelId: "anthropic/claude", name: "Claude", provider: "anthropic" },
    ];
    const onSelectPersona = vi.fn();
    const onSelectModel = vi.fn();
    const onClose = vi.fn();

    const { rerender } = render(
      <ParticipantPicker
        selectedPersonaId={null}
        selectedModelId="openai/gpt-4o"
        onSelectPersona={onSelectPersona}
        onSelectModel={onSelectModel}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getAllByText("Guide")[1]);
    expect(onSelectPersona).toHaveBeenCalledWith("persona_1");
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ParticipantPicker
        selectedPersonaId={null}
        selectedModelId="openai/gpt-4o"
        onSelectPersona={onSelectPersona}
        onSelectModel={onSelectModel}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("Claude"));
    expect(onSelectModel).toHaveBeenCalledWith("anthropic/claude");
    expect(onClose).toHaveBeenCalledTimes(2);

    rerender(
      <ParticipantPicker
        selectedPersonaId={null}
        selectedModelId="openai/gpt-4o"
        onSelectPersona={onSelectPersona}
        onSelectModel={onSelectModel}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /help me choose/i }));
    fireEvent.click(screen.getByRole("button", { name: "Pick wizard model" }));
    expect(onSelectModel).toHaveBeenLastCalledWith("anthropic/claude");
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("filters visible participants by search text", () => {
    personas = [{ _id: "persona_1", displayName: "Guide" }];
    modelSummaries = [
      { modelId: "openai/gpt-4o", name: "GPT-4o", provider: "openai" },
      { modelId: "anthropic/claude", name: "Claude", provider: "anthropic" },
    ];

    render(
      <ParticipantPicker
        selectedPersonaId={null}
        selectedModelId="openai/gpt-4o"
        onSelectPersona={vi.fn()}
        onSelectModel={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/search models/i), { target: { value: "claude" } });

    expect(screen.queryByText("Guide")).not.toBeInTheDocument();
    expect(screen.queryByText("GPT-4o")).not.toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
  });
});
