import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { AdvisorComposerOwner } from "@/hooks/useAdvisorComposer";
import type { PersonaItem } from "@/components/chat/ChatParticipantPicker.helpers";
import { AdvisorPicker } from "@/components/chat/AdvisorPicker";

vi.mock("@/hooks/useSharedData", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/hooks/useSharedData")>(),
  useModelSummaries: () => [],
}));

const personas: PersonaItem[] = ["Maya", "Lee", "Sam", "Noor"].map((displayName, index) => ({
  _id: `persona_${index}` as Id<"personas">,
  displayName,
  personaDescription: `${displayName} description`,
}));

function owner(overrides: Partial<AdvisorComposerOwner> = {}): AdvisorComposerOwner {
  return {
    state: {
      chatKey: "chat_1",
      surface: "picker",
      selections: [],
      brief: "",
      defaultAllowWebSearch: true,
      defaultKeepAvailable: false,
      saveError: null,
      isSaving: false,
      isHydrated: true,
    },
    participantCount: 1,
    eligibility: { isAvailable: true, maxAdvisors: 3, keptCount: 0, remainingCapacity: 3 },
    isHydrated: true,
    unavailablePersonaIds: new Set(),
    persistedPersonaIds: new Set(),
    participantPersonaIds: new Set(),
    selectedPersonas: [],
    canSendCurrentSelection: true,
    canCaptureQueuedSnapshot: true,
    advisorSelections: undefined,
    advisorBrief: undefined,
    open: vi.fn(),
    close: vi.fn(),
    togglePersona: vi.fn(),
    updateSelection: vi.fn(),
    remove: vi.fn(async () => {}),
    setBrief: vi.fn(),
    setDefaultAllowWebSearch: vi.fn(),
    setDefaultKeepAvailable: vi.fn(),
    save: vi.fn(async () => {}),
    captureQueuedSnapshot: vi.fn(() => ({ advisorSelections: [] })),
    restoreQueuedSnapshot: vi.fn(),
    completeSuccessfulSend: vi.fn(),
    ...overrides,
  };
}

describe("AdvisorPicker", () => {
  it("shows Persona-only selection, the optional brief, and sheet defaults", () => {
    const composer = owner();
    render(<AdvisorPicker owner={composer} personas={personas} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("What should your Advisors focus on?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Maya"));
    expect(composer.togglePersona).toHaveBeenCalledWith("persona_0");
    fireEvent.click(screen.getByLabelText("Internet for new selections"));
    expect(composer.setDefaultAllowWebSearch).toHaveBeenCalledWith(false);
  });

  it("enforces the three-Advisor cap and exposes per-Advisor controls", () => {
    const selections = personas.slice(0, 3).map((persona) => ({
      personaId: persona._id,
      allowWebSearch: false,
      keepAvailable: false,
    }));
    const composer = owner({
      state: { ...owner().state, selections },
      selectedPersonas: personas.slice(0, 3),
      advisorSelections: selections,
    });
    render(<AdvisorPicker owner={composer} personas={personas} />);

    expect(screen.getByRole("button", { name: /Noor/ })).toBeDisabled();
    const internetToggles = screen.getAllByLabelText("Allow internet access");
    fireEvent.click(internetToggles[0]!);
    expect(composer.updateSelection).toHaveBeenCalledWith("persona_1", { allowWebSearch: true });
  });

  it("explains that multi-model turns use one shared Advisor selection", () => {
    render(<AdvisorPicker owner={owner({ participantCount: 3 })} personas={personas} />);

    expect(screen.getByText("All 3 text participants receive the same private Advisor notes.")).toBeInTheDocument();
    expect(screen.queryByText(/assign to participant/i)).not.toBeInTheDocument();
  });

  it("disables unavailable Personas while retaining selected assignments for removal", () => {
    const unavailable = personas[0]!;
    const selection = {
      personaId: unavailable._id,
      allowWebSearch: false,
      keepAvailable: true,
    };
    const { rerender } = render(
      <AdvisorPicker
        owner={owner({ unavailablePersonaIds: new Set([String(unavailable._id)]) })}
        personas={personas}
      />,
    );
    expect(screen.getByRole("button", { name: /Maya/ })).toBeDisabled();
    expect(screen.getByText(/needs a text-output model/i)).toBeInTheDocument();

    rerender(
      <AdvisorPicker
        owner={owner({
          unavailablePersonaIds: new Set([String(unavailable._id)]),
          state: { ...owner().state, selections: [selection] },
          selectedPersonas: [unavailable],
        })}
        personas={personas}
      />,
    );
    expect(screen.getByRole("button", { name: /Maya/ })).not.toBeDisabled();
  });

  it("focuses the search, closes on Escape, and disables Save before hydration", async () => {
    const composer = owner({ isHydrated: false });
    render(<AdvisorPicker owner={composer} personas={personas} />);

    expect(await screen.findByPlaceholderText("What should your Advisors focus on?")).toBeDisabled();
    expect(screen.getByRole("textbox", { name: "Search personas…" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Loading Advisors…" })).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(composer.close).toHaveBeenCalledTimes(1);
  });

  it("traps keyboard focus and restores the previously focused control", () => {
    const previousControl = document.createElement("button");
    document.body.appendChild(previousControl);
    previousControl.focus();
    const view = render(<AdvisorPicker owner={owner()} personas={personas} />);

    const close = screen.getByRole("button", { name: "Close" });
    const done = screen.getByRole("button", { name: "Done" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(done).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    view.unmount();
    expect(previousControl).toHaveFocus();
    previousControl.remove();
  });

  it("contains focus in Persona details and restores it when the nested dialog closes", () => {
    render(<AdvisorPicker owner={owner()} personas={personas} />);
    const infoButton = screen.getAllByRole("button", { name: "Persona info" })[0]!;
    fireEvent.click(infoButton);

    const details = screen.getByRole("dialog", { name: "Persona info" });
    const detailsClose = within(details).getByRole("button", { name: "Close" });
    expect(detailsClose).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(detailsClose).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Persona info" })).not.toBeInTheDocument();
    expect(infoButton).toHaveFocus();
  });
});
