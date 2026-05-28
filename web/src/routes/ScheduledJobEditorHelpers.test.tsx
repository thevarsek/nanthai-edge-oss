import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  RecurrencePicker,
  StepIntegrationsSection,
  StepKnowledgeBaseSection,
  StepListSection,
  StepOptionsSection,
  StepParticipantSection,
  StepSearchSection,
  StepTaskSection,
} from "./ScheduledJobEditorHelpers";
import { createDraftStep } from "./ScheduledJobEditor.model";

const mockState = vi.hoisted(() => ({
  connectedAccounts: {
    googleConnection: { hasDrive: false, hasCalendar: false },
    gmailManualConnection: null,
    microsoftConnection: null,
    appleCalendarConnection: null,
    notionConnection: null,
    clozeConnection: null,
    slackConnection: null,
  } as {
    googleConnection: { hasDrive: boolean; hasCalendar: boolean } | null;
    gmailManualConnection: { status: string } | null;
    microsoftConnection: unknown;
    appleCalendarConnection: unknown;
    notionConnection: unknown;
    clozeConnection: { status: string } | null;
    slackConnection: unknown;
  },
  sharedData: {
    prefs: { zdrEnabled: false },
    personas: [
      { _id: "persona_1", displayName: "Researcher", personaDescription: "Finds facts", avatarEmoji: "R", modelId: "openai/gpt-4.1" },
    ],
  },
  modelSummaries: [
    { modelId: "openai/gpt-4.1", name: "GPT 4.1", provider: "openai", hasZdrEndpoint: true },
    { modelId: "google/gemini-3-pro", name: "Gemini 3 Pro", provider: "google", hasZdrEndpoint: false },
  ],
  toast: vi.fn(),
  connectProviderWithPopup: vi.fn(async (provider: string, options: unknown) => {
    void provider;
    void options;
    return null;
  }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  useConnectedAccounts: () => mockState.connectedAccounts,
  useModelSummaries: () => mockState.modelSummaries,
  useSharedData: () => mockState.sharedData,
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: mockState.toast }),
}));

vi.mock("@/lib/providerOAuth", () => ({
  connectProviderWithPopup: (provider: string, options: unknown) => mockState.connectProviderWithPopup(provider, options),
}));

vi.mock("@/components/chat/ChatKBPicker", () => ({
  ChatKBPicker: ({ onToggle, onClose }: { onToggle: (id: string) => void; onClose: () => void }) => (
    <div role="dialog">
      <button onClick={() => onToggle("file_2")}>Toggle KB file</button>
      <button onClick={onClose}>Close KB</button>
    </div>
  ),
}));

beforeEach(() => {
  mockState.connectedAccounts = {
    googleConnection: { hasDrive: false, hasCalendar: false },
    gmailManualConnection: null,
    microsoftConnection: null,
    appleCalendarConnection: null,
    notionConnection: null,
    clozeConnection: null,
    slackConnection: null,
  };
  mockState.sharedData = {
    prefs: { zdrEnabled: false },
    personas: [
      { _id: "persona_1", displayName: "Researcher", personaDescription: "Finds facts", avatarEmoji: "R", modelId: "openai/gpt-4.1" },
    ],
  };
  mockState.toast.mockReset();
  mockState.connectProviderWithPopup.mockReset();
});

describe("ScheduledJobEditorHelpers", () => {
  it("shows Google Drive and Calendar rows when Google is connected but scopes are missing", () => {
    render(<StepIntegrationsSection step={createDraftStep()} onChange={vi.fn()} />);

    expect(screen.getByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByText("Google Calendar")).toBeInTheDocument();
  });

  it("routes Google scope upgrades through OAuth and blocks missing Gmail app password", async () => {
    const onChange = vi.fn();
    render(<StepIntegrationsSection step={createDraftStep()} onChange={onChange} />);

    fireEvent.click(screen.getAllByRole("switch")[0]!);
    await waitFor(() => expect(mockState.connectProviderWithPopup).toHaveBeenCalledWith("google", { requestedIntegration: "drive" }));
    expect(onChange).toHaveBeenCalledWith({ driveEnabled: true });

    mockState.connectedAccounts = {
      ...mockState.connectedAccounts,
      googleConnection: null,
      gmailManualConnection: null,
    };
    const { rerender } = render(<StepIntegrationsSection step={createDraftStep()} onChange={onChange} />);
    rerender(<StepIntegrationsSection step={{ ...createDraftStep(), gmailEnabled: false }} onChange={onChange} />);
    expect(screen.getByText(/Connect accounts/)).toBeInTheDocument();
  });

  it("updates step list ordering controls and selected task fields", () => {
    const onSelect = vi.fn();
    const onAdd = vi.fn();
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    const onRemove = vi.fn();
    const steps = [
      { ...createDraftStep(), id: "step_1", title: "Collect", prompt: "Find sources" },
      { ...createDraftStep(), id: "step_2", title: "", prompt: "" },
    ];

    render(
      <>
        <StepListSection steps={steps} selectedIdx={1} onSelect={onSelect} onAdd={onAdd} onMoveUp={onMoveUp} onMoveDown={onMoveDown} onRemove={onRemove} />
        <StepTaskSection step={steps[0]!} onChange={onSelect} />
      </>,
    );

    fireEvent.click(screen.getByText("Collect"));
    expect(onSelect).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByText("Add Step"));
    fireEvent.click(screen.getByText("Move Up"));
    fireEvent.click(screen.getByText("Remove Step"));
    expect(onAdd).toHaveBeenCalled();
    expect(onMoveUp).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Step title (optional)"), { target: { value: "Draft" } });
    expect(onSelect).toHaveBeenCalledWith({ title: "Draft" });
  });

  it("selects personas and models while respecting ZDR-disabled choices", () => {
    const onChange = vi.fn();
    mockState.sharedData = { ...mockState.sharedData, prefs: { zdrEnabled: true } };
    render(<StepParticipantSection step={createDraftStep()} onChange={onChange} />);

    fireEvent.click(screen.getByText("Model & Persona"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "research" } });
    fireEvent.click(screen.getByText("Researcher"));
    expect(onChange).toHaveBeenCalledWith({ selectedPersonaId: "persona_1", modelId: "openai/gpt-4.1" });

    fireEvent.click(screen.getByText("Model & Persona"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "gemini" } });
    fireEvent.click(screen.getByText("Gemini 3 Pro"));
    expect(onChange).not.toHaveBeenCalledWith({ modelId: "google/gemini-3-pro", selectedPersonaId: null });
    expect(screen.getByText("This model doesn't support Zero Data Retention.")).toBeInTheDocument();
  });

  it("updates search, knowledge-base, reasoning, and recurrence controls", () => {
    const onChange = vi.fn();
    const onRecurrenceType = vi.fn();
    const onIntervalMinutes = vi.fn();
    const onDailyHour = vi.fn();
    const onDailyMinute = vi.fn();
    const step = { ...createDraftStep(), searchMode: "web" as const, searchComplexity: 1, includeReasoning: true, knowledgeBaseFileIds: ["file_1"] };

    const { rerender } = render(
      <>
        <StepSearchSection step={step} onChange={onChange} />
        <StepKnowledgeBaseSection step={step} onChange={onChange} />
        <StepOptionsSection step={step} onChange={onChange} />
        <RecurrencePicker
          recurrenceType="interval"
          intervalMinutes={30}
          dailyHour={8}
          dailyMinute={15}
          weeklyDay={1}
          cronExpression=""
          onRecurrenceType={onRecurrenceType}
          onIntervalMinutes={onIntervalMinutes}
          onDailyHour={onDailyHour}
          onDailyMinute={onDailyMinute}
          onWeeklyDay={vi.fn()}
          onCronExpression={vi.fn()}
        />
      </>,
    );

    fireEvent.change(screen.getByDisplayValue("Web Search"), { target: { value: "research" } });
    expect(onChange).toHaveBeenCalledWith({ searchMode: "research" });
    fireEvent.click(screen.getByText("Comprehensive"));
    expect(onChange).toHaveBeenCalledWith({ searchComplexity: 3 });
    fireEvent.click(screen.getByText("1 file"));
    fireEvent.click(screen.getByText("Toggle KB file"));
    expect(onChange).toHaveBeenCalledWith({ knowledgeBaseFileIds: ["file_1", "file_2"] });
    fireEvent.click(screen.getByText("high"));
    expect(onChange).toHaveBeenCalledWith({ reasoningEffort: "high" });
    fireEvent.click(screen.getByText("1h"));
    expect(onIntervalMinutes).toHaveBeenCalledWith(60);
    fireEvent.click(screen.getByText("Daily"));
    expect(onRecurrenceType).toHaveBeenCalledWith("daily");

    rerender(
      <RecurrencePicker
        recurrenceType="daily"
        intervalMinutes={30}
        dailyHour={8}
        dailyMinute={15}
        weeklyDay={1}
        cronExpression=""
        onRecurrenceType={onRecurrenceType}
        onIntervalMinutes={onIntervalMinutes}
        onDailyHour={onDailyHour}
        onDailyMinute={onDailyMinute}
        onWeeklyDay={vi.fn()}
        onCronExpression={vi.fn()}
      />,
    );
    fireEvent.change(document.querySelector("input[type='time']")!, { target: { value: "09:45" } });
    expect(onDailyHour).toHaveBeenCalled();
    expect(onDailyMinute).toHaveBeenCalled();
  });
});
