import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FavoriteEditorModal, type FavoriteDoc } from "./ManageFavoritesHelpers";

const state = vi.hoisted(() => ({
  sharedData: {
    prefs: { defaultModelId: "openai/gpt-4.1", zdrEnabled: false },
    personas: [
      { _id: "persona_1", displayName: "Researcher", avatarEmoji: "R", modelId: "openai/gpt-4.1" },
      { _id: "persona_image", displayName: "Artist", avatarEmoji: "A", modelId: "black-forest-labs/flux" },
    ],
  },
  models: [
    { modelId: "openai/gpt-4.1", name: "GPT 4.1", inputModalities: ["text"], outputModalities: ["text"] },
    { modelId: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet", inputModalities: ["text"], outputModalities: ["text"] },
    { modelId: "google/gemini-2.5-pro", name: "Gemini Pro", inputModalities: ["text"], outputModalities: ["text"] },
    { modelId: "black-forest-labs/flux", name: "Flux", supportsImages: true, architecture: { modality: "text->image" } },
  ],
  createFavorite: vi.fn(async () => null),
  updateFavorite: vi.fn(async () => null),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.var1 === "number") return `${key}:${options.var1}`;
      if (typeof options?.var1 === "string") return `${key}:${options.var1}`;
      return key;
    },
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: { _name?: string }) =>
    mutation?._name?.includes("updateFavorite") ? state.updateFavorite : state.createFavorite,
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    favorites: {
      mutations: {
        createFavorite: { _name: "favorites.mutations.createFavorite" },
        updateFavorite: { _name: "favorites.mutations.updateFavorite" },
      },
    },
  },
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => state.sharedData,
  useModelSummaries: () => state.models,
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span data-testid="provider-logo">{modelId}</span>,
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName }: { personaName?: string }) => <span data-testid="persona-avatar">{personaName}</span>,
}));

vi.mock("@/components/shared/ConfirmDialog", () => ({
  ConfirmDialog: ({ isOpen, title, description, confirmLabel, onClose, onConfirm }: {
    isOpen: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    onClose: () => void;
    onConfirm: () => void;
  }) => isOpen ? (
    <div role="dialog" aria-label={title}>
      <p>{description}</p>
      <button onClick={onClose}>cancel-switch</button>
      <button onClick={onConfirm}>{confirmLabel}</button>
    </div>
  ) : null,
}));

vi.mock("@/components/shared/PersonaInfoSheet", () => ({
  PersonaInfoSheet: ({ persona, onClose }: { persona: { displayName: string }; onClose: () => void }) => (
    <button onClick={onClose}>persona-info-{persona.displayName}</button>
  ),
}));

vi.mock("@/components/shared/ModelPickerHelpers", () => ({
  ModelInfoSheet: ({ model, onClose }: { model: { name: string }; onClose: () => void }) => (
    <button onClick={onClose}>model-info-{model.name}</button>
  ),
  ModelWizard: ({ models, onSelect, onClose }: { models: Array<{ modelId: string }>; onSelect: (id: string) => void; onClose: () => void }) => (
    <div>
      <button onClick={() => onSelect(models[0]!.modelId)}>wizard-select</button>
      <button onClick={onClose}>wizard-close</button>
    </div>
  ),
}));

vi.mock("@/components/chat/ChatParticipantPicker.sortmenu", () => ({
  SortMenuPortal: ({ onChange }: { onChange: (value: string) => void }) => (
    <button onClick={() => onChange("price")}>sort-menu</button>
  ),
}));

vi.mock("@/components/chat/ChatParticipantPicker.helpers", () => ({
  SectionHeader: ({ title, count }: { title: string; count: number }) => <h4>{title}:{count}</h4>,
  PersonaRow: ({ persona, isSelected, disabled, onToggle, onInfo }: {
    persona: { _id: string; displayName: string };
    isSelected: boolean;
    disabled: boolean;
    onToggle: (persona: unknown) => void;
    onInfo: (persona: unknown) => void;
  }) => (
    <div>
      <button disabled={disabled} onClick={() => onToggle(persona)}>
        persona-{persona.displayName}-{isSelected ? "selected" : "idle"}
      </button>
      <button onClick={() => onInfo(persona)}>info-{persona.displayName}</button>
    </div>
  ),
  ParticipantModelRow: ({ model, isSelected, disabled, onToggle, onInfo }: {
    model: { modelId: string; name: string };
    isSelected: boolean;
    disabled: boolean;
    onToggle: (modelId: string) => void;
    onInfo: (model: unknown) => void;
  }) => (
    <div>
      <button disabled={disabled} onClick={() => onToggle(model.modelId)}>
        model-{model.name}-{isSelected ? "selected" : "idle"}
      </button>
      <button onClick={() => onInfo(model)}>info-{model.name}</button>
    </div>
  ),
}));

function renderModal(editing: FavoriteDoc | null = null) {
  return render(
    <FavoriteEditorModal
      editing={editing}
      onClose={vi.fn()}
      onSaved={state.createFavorite}
    />,
  );
}

beforeEach(() => {
  state.sharedData = {
    prefs: { defaultModelId: "openai/gpt-4.1", zdrEnabled: false },
    personas: [
      { _id: "persona_1", displayName: "Researcher", avatarEmoji: "R", modelId: "openai/gpt-4.1" },
      { _id: "persona_image", displayName: "Artist", avatarEmoji: "A", modelId: "black-forest-labs/flux" },
    ],
  };
  state.models = [
    { modelId: "openai/gpt-4.1", name: "GPT 4.1", inputModalities: ["text"], outputModalities: ["text"] },
    { modelId: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet", inputModalities: ["text"], outputModalities: ["text"] },
    { modelId: "google/gemini-2.5-pro", name: "Gemini Pro", inputModalities: ["text"], outputModalities: ["text"] },
    { modelId: "black-forest-labs/flux", name: "Flux", supportsImages: true, architecture: { modality: "text->image" } },
  ];
  state.createFavorite.mockReset();
  state.createFavorite.mockResolvedValue(null);
  state.updateFavorite.mockReset();
  state.updateFavorite.mockResolvedValue(null);
});

describe("FavoriteEditorModal", () => {
  it("creates a single-model favorite with an auto-resolved name and participant payload", async () => {
    renderModal();

    expect(screen.getByText("select_models_or_personas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();

    fireEvent.click(screen.getByText("add_model_or_persona"));
    fireEvent.click(screen.getByText("model-GPT 4.1-idle"));
    expect(screen.getByText("GPT 4.1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(state.createFavorite).toHaveBeenCalledWith({
      name: "GPT 4.1",
      modelIds: ["openai/gpt-4.1"],
      participants: [{ modelId: "openai/gpt-4.1" }],
    }));
  });

  it("creates a named multi-participant favorite and enforces the three-selection limit", async () => {
    renderModal();

    fireEvent.click(screen.getByText("add_model_or_persona"));
    fireEvent.click(screen.getByText("model-GPT 4.1-idle"));
    fireEvent.click(screen.getByText("model-Claude Sonnet-idle"));
    fireEvent.click(screen.getByText("persona-Researcher-idle"));
    expect(screen.getAllByText("3/3").length).toBeGreaterThan(0);
    expect(screen.queryByText("add_model_or_persona")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("group_name_placeholder"), { target: { value: "Research trio" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(state.createFavorite).toHaveBeenCalledWith(expect.objectContaining({
      name: "Research trio",
      modelIds: ["openai/gpt-4.1", "anthropic/claude-sonnet-4.5", "openai/gpt-4.1"],
      personaId: "persona_1",
      personaName: "Researcher",
      participants: [
        { modelId: "openai/gpt-4.1" },
        { modelId: "anthropic/claude-sonnet-4.5" },
        {
          modelId: "openai/gpt-4.1",
          personaId: "persona_1",
          personaName: "Researcher",
          personaEmoji: "R",
          personaAvatarImageUrl: undefined,
        },
      ],
    })));
  });

  it("updates existing favorites and preserves participant persona metadata", async () => {
    renderModal({
      _id: "favorite_1" as never,
      name: "Old name",
      modelIds: ["openai/gpt-4.1"],
      participants: [{
        modelId: "openai/gpt-4.1",
        personaId: "persona_1",
        personaName: "Researcher",
        personaEmoji: "R",
        personaAvatarImageUrl: null,
      }],
      sortOrder: 1,
    });

    fireEvent.change(screen.getByPlaceholderText("Researcher"), { target: { value: "Better researcher" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(state.updateFavorite).toHaveBeenCalledWith({
      favoriteId: "favorite_1",
      name: "Better researcher",
      modelIds: ["openai/gpt-4.1"],
      participants: [{
        modelId: "openai/gpt-4.1",
        personaId: "persona_1",
        personaName: "Researcher",
        personaEmoji: "R",
        personaAvatarImageUrl: undefined,
      }],
      personaId: "persona_1",
      personaName: "Researcher",
      personaEmoji: "R",
      personaAvatarImageUrl: null,
    }));
  });

  it("requires confirmation before switching output modality families", async () => {
    renderModal();

    fireEvent.click(screen.getByText("add_model_or_persona"));
    fireEvent.click(screen.getByText("model-GPT 4.1-idle"));
    fireEvent.click(screen.getByText("model-Flux-idle"));
    expect(screen.getByRole("dialog", { name: "modality_switch_title:image generation" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("modality_switch_confirm"));
    expect(screen.queryByText("GPT 4.1")).not.toBeInTheDocument();
    expect(screen.getByText("Flux")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(state.createFavorite).toHaveBeenCalledWith({
      name: "Flux",
      modelIds: ["black-forest-labs/flux"],
      participants: [{ modelId: "black-forest-labs/flux" }],
    }));
  });

  it("surfaces save errors without closing the modal", async () => {
    state.createFavorite.mockRejectedValueOnce(new Error("network"));
    renderModal();

    fireEvent.click(screen.getByText("add_model_or_persona"));
    fireEvent.click(screen.getByText("model-GPT 4.1-idle"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(screen.getByText("favorite_save_error")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "save" })).not.toBeDisabled();
  });
});
