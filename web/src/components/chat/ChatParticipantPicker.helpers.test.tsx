import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";
import type { ParticipantEntry } from "@/hooks/useParticipants";
import { ParticipantModelRow, PersonaRow, SectionHeader, SelectedSection, type PersonaItem } from "./ChatParticipantPicker.helpers";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName, personaEmoji }: { personaName?: string; personaEmoji?: string }) => (
    <span data-testid="persona-avatar">{personaName ?? personaEmoji}</span>
  ),
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span data-testid="provider-logo">{modelId}</span>,
}));

const modelNameMap = new Map([
  ["openai/gpt-5.2", "GPT 5.2"],
  ["anthropic/claude-sonnet-4", "Claude Sonnet 4"],
  ["google/gemini-3-pro", "Gemini 3 Pro"],
]);

function participant(overrides: Partial<ParticipantEntry> = {}): ParticipantEntry {
  return {
    id: "participant_1" as Id<"chatParticipants">,
    modelId: "openai/gpt-5.2",
    personaId: null,
    personaName: null,
    personaEmoji: null,
    personaAvatarImageUrl: null,
    sortOrder: 0,
    ...overrides,
  };
}

function persona(overrides: Partial<PersonaItem> = {}): PersonaItem {
  return {
    _id: "persona_1" as Id<"personas">,
    displayName: "Planner",
    modelId: "openai/gpt-5.2",
    avatarEmoji: "P",
    ...overrides,
  };
}

function model(overrides: Partial<ModelSummary> = {}): ModelSummary {
  return {
    modelId: "openai/gpt-5.2",
    name: "GPT 5.2",
    provider: "openai",
    hasZdrEndpoint: true,
    supportsTools: true,
    supportsImages: true,
    supportsVideo: false,
    inputPrice: 1,
    outputPrice: 2,
    architecture: { modality: "image+text->text" },
    openRouterUseCases: [{ category: "coding", returnedRank: 2 }],
    derivedGuidance: { primaryLabel: "coding.best" },
    ...overrides,
  } as ModelSummary;
}

describe("ChatParticipantPicker helper rows", () => {
  it("renders section counts and disables removing the final selected participant", () => {
    const onRemove = vi.fn();
    const { rerender } = render(
      <>
        <SectionHeader title="Models" count={2} className="sticky" />
        <SelectedSection
          participants={[participant()]}
          onRemove={onRemove}
          modelNameMap={modelNameMap}
        />
      </>,
    );

    expect(screen.getByText("Models (2)")).toHaveClass("sticky");
    fireEvent.click(screen.getByTitle("cannot_remove_last_participant"));
    expect(onRemove).not.toHaveBeenCalled();

    rerender(
      <SelectedSection
        participants={[
          participant({ id: "participant_1" as Id<"chatParticipants"> }),
          participant({
            id: "participant_2" as Id<"chatParticipants">,
            personaId: "persona_1" as Id<"personas">,
            personaName: "Planner",
            personaEmoji: "P",
          }),
        ]}
        onRemove={onRemove}
        modelNameMap={modelNameMap}
      />,
    );

    fireEvent.click(screen.getAllByTitle("remove_participant")[1]);
    expect(onRemove).toHaveBeenCalledWith("participant_2");
    expect(screen.getAllByText("Planner")).toHaveLength(2);
    expect(screen.getAllByText("GPT 5.2")).toHaveLength(2);
  });

  it("keeps blocked persona rows inert while selected rows remain removable and info clicks stay scoped", () => {
    const onToggle = vi.fn();
    const onInfo = vi.fn();
    const { rerender } = render(
      <PersonaRow
        persona={persona({ modelId: "google/gemini-3-pro" })}
        isSelected={false}
        disabled={false}
        onToggle={onToggle}
        onInfo={onInfo}
        modelNameMap={modelNameMap}
        googleIntegrationsActive
        modelZdrMap={new Map([["google/gemini-3-pro", false]])}
        modelProviderMap={new Map([["google/gemini-3-pro", "google"]])}
      />,
    );

    fireEvent.click(screen.getAllByText("Planner")[1]);
    expect(onToggle).not.toHaveBeenCalled();
    expect(screen.getByText("zdr_model_not_available_google")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("persona_info"));
    expect(onInfo).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Planner" }));
    expect(onToggle).not.toHaveBeenCalled();

    rerender(
      <PersonaRow
        persona={persona({ modelId: undefined })}
        isSelected
        disabled
        onToggle={onToggle}
        onInfo={onInfo}
        modelNameMap={modelNameMap}
        zdrEnforced
        modelZdrMap={new Map([["openai/gpt-5.2", true]])}
        fallbackModelId="openai/gpt-5.2"
      />,
    );

    fireEvent.click(screen.getAllByText("Planner")[1]);
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Planner" }));
  });

  it("toggles enabled persona rows from keyboard without nesting the info action", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onInfo = vi.fn();
    render(
      <PersonaRow
        persona={persona()}
        isSelected={false}
        disabled={false}
        onToggle={onToggle}
        onInfo={onInfo}
        modelNameMap={modelNameMap}
      />,
    );

    const row = screen.getByRole("button", { name: /Planner/ });
    await user.tab();
    expect(row).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Planner" }));

    await user.tab();
    expect(screen.getByTitle("persona_info")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onInfo).toHaveBeenCalledWith(expect.objectContaining({ displayName: "Planner" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("renders model badges, guidance scores, prices, and blocked-state copy", () => {
    const onToggle = vi.fn();
    const onInfo = vi.fn();
    const { rerender } = render(
      <ParticipantModelRow
        model={model()}
        isSelected={false}
        disabled={false}
        sortKey="coding"
        onToggle={onToggle}
        onInfo={onInfo}
      />,
    );

    const row = screen.getByText("GPT 5.2").closest("div")!.parentElement!;
    expect(within(row).getByText("best_for_coding")).toBeInTheDocument();
    expect(within(row).getByText("popular")).toBeInTheDocument();

    fireEvent.click(screen.getByText("GPT 5.2"));
    expect(onToggle).toHaveBeenCalledWith("openai/gpt-5.2");

    fireEvent.click(screen.getByTitle("model_info"));
    expect(onInfo).toHaveBeenCalledWith(expect.objectContaining({ modelId: "openai/gpt-5.2" }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <ParticipantModelRow
        model={model({
          modelId: "anthropic/claude-sonnet-4",
          name: "Claude Sonnet 4",
          provider: "anthropic",
          hasZdrEndpoint: false,
          supportsImages: false,
          supportsTools: false,
          supportsVideo: true,
          supportedFrameImages: ["first_frame"],
          isFree: true,
          openRouterUseCases: [{ category: "research", returnedRank: 8 }],
          derivedGuidance: { primaryLabel: "custom.label" },
        })}
        isSelected={false}
        disabled={false}
        sortKey="topThisWeek"
        onToggle={onToggle}
        onInfo={onInfo}
        googleIntegrationsActive
      />,
    );

    fireEvent.click(screen.getByText("Claude Sonnet 4"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByText("zdr_model_not_available_google")).toBeInTheDocument();
    expect(screen.getByText("trending")).toBeInTheDocument();
    expect(screen.getByText("custom.label")).toBeInTheDocument();
  });

  it("toggles model rows from keyboard and skips disabled unselected rows", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <ParticipantModelRow
        model={model()}
        isSelected={false}
        disabled={false}
        sortKey="coding"
        onToggle={onToggle}
        onInfo={vi.fn()}
      />,
    );

    const row = screen.getByRole("button", { name: /GPT 5\.2/ });
    await user.tab();
    expect(row).toHaveFocus();
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledWith("openai/gpt-5.2");

    rerender(
      <ParticipantModelRow
        model={model({ hasZdrEndpoint: false })}
        isSelected={false}
        disabled={false}
        sortKey="coding"
        onToggle={onToggle}
        onInfo={vi.fn()}
        zdrEnforced
      />,
    );

    const disabledRow = screen.getByRole("button", { name: /GPT 5\.2/ });
    expect(disabledRow).toHaveAttribute("aria-disabled", "true");
    expect(disabledRow).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(disabledRow, { key: "Enter" });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
