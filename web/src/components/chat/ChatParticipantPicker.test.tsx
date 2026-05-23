import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatParticipantPicker } from "./ChatParticipantPicker";

let personas: unknown[] = [];
let modelSummaries: unknown[] = [
  { modelId: "text-model", name: "Text Model", provider: "OpenAI" },
  { modelId: "video-model", name: "Video Model", provider: "Runway", supportsVideo: true },
];

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ personas, prefs: {} }),
  useModelSummaries: () => modelSummaries,
}));

vi.mock("@/components/shared/ModelPickerHelpers", () => ({
  ModelInfoSheet: () => null,
  ModelWizard: ({ onSelect }: { onSelect: (modelId: string) => void }) => (
    <button type="button" onClick={() => onSelect("video-model")}>
      Select video model
    </button>
  ),
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName }: { personaName?: string }) => <span>{personaName}</span>,
}));

describe("ChatParticipantPicker", () => {
  beforeEach(() => {
    personas = [];
    modelSummaries = [
      { modelId: "text-model", name: "Text Model", provider: "OpenAI" },
      { modelId: "video-model", name: "Video Model", provider: "Runway", supportsVideo: true },
    ];
  });

  it("closes the model wizard after confirming a modality switch", async () => {
    const onSetParticipants = vi.fn(async () => undefined);

    render(
      <ChatParticipantPicker
        chatId={"chat_1" as never}
        participants={[{ id: "participant_1", modelId: "text-model", sortOrder: 0 } as never]}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        onSetParticipants={onSetParticipants}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /help me choose/i }));
    fireEvent.click(screen.getByRole("button", { name: "Select video model" }));
    fireEvent.click(screen.getByRole("button", { name: /switch/i }));

    await waitFor(() => {
      expect(onSetParticipants).toHaveBeenCalledWith("chat_1", [{ modelId: "video-model" }]);
    });
    expect(screen.queryByRole("button", { name: "Select video model" })).not.toBeInTheDocument();
  });

  it("blocks personas without explicit models when the default model is incompatible with Google integrations", () => {
    personas = [{ _id: "persona_1", displayName: "Default Persona" }];
    modelSummaries = [
      { modelId: "openai/gpt-5.5", name: "GPT-5.5", provider: "openai", hasZdrEndpoint: false },
      { modelId: "text-model", name: "Text Model", provider: "OpenAI", hasZdrEndpoint: true },
    ];
    const onAdd = vi.fn();

    render(
      <ChatParticipantPicker
        chatId={"chat_1" as never}
        participants={[]}
        onAdd={onAdd}
        onRemove={vi.fn()}
        onClose={vi.fn()}
        enabledIntegrations={new Set(["drive"])}
      />,
    );

    fireEvent.click(screen.getAllByText("Default Persona")[1]);

    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getAllByText(/google/i).length).toBeGreaterThan(0);
  });
});
