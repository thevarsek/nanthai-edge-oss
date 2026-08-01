import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { ScheduledJobEditor } from "./ScheduledJobEditor";

const mockState = vi.hoisted(() => ({
  folders: [
    { _id: "folder_reports", name: "Reports" },
    { _id: "folder_ops", name: "Ops" },
  ],
  remoteMcpConnections: [] as Array<{
    connectionId: string;
    integrationId: string;
    displayName: string;
    endpointHost: string;
    allowedItemCount: number;
  }>,
  modelSummaries: [
    { modelId: "openai/gpt-4o", name: "GPT-4o", provider: "openai", supportsTools: true, hasZdrEndpoint: true },
    { modelId: "anthropic/claude-3-haiku", name: "Haiku", provider: "anthropic", supportsTools: false, hasZdrEndpoint: true },
    { modelId: "google/gemini-pro", name: "Gemini", provider: "google", supportsTools: true, hasZdrEndpoint: false },
  ],
  sharedData: { personas: [] as Array<{ _id: string; modelId?: string }> },
  mutationHookIndex: 0,
  createJob: vi.fn(async () => null),
  updateJob: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => args === undefined
    ? mockState.folders
    : mockState.remoteMcpConnections,
  useMutation: () => {
    const index = mockState.mutationHookIndex++;
    return index % 2 === 0 ? mockState.createJob : mockState.updateJob;
  },
}));

vi.mock("@/hooks/useSharedData", () => ({
  useModelSummaries: () => mockState.modelSummaries,
  useSharedData: () => mockState.sharedData,
}));

vi.mock("./ScheduledJobEditorHelpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ScheduledJobEditorHelpers")>();
  return {
    SH: actual.SH,
    SF: ({ children, error }: { children: React.ReactNode; error?: boolean }) => (
      <p role={error ? "alert" : undefined}>{children}</p>
    ),
    StepListSection: ({ steps, selectedIdx, onSelect, onAdd, onMoveUp, onMoveDown, onRemove }: {
      steps: Array<{ title: string; prompt: string }>;
      selectedIdx: number;
      onSelect: (idx: number) => void;
      onAdd: () => void;
      onMoveUp: () => void;
      onMoveDown: () => void;
      onRemove: () => void;
    }) => (
      <section aria-label="steps">
        <p>selected-step-{selectedIdx + 1}</p>
        {steps.map((step, index) => (
          <button key={index} type="button" onClick={() => onSelect(index)}>
            {step.title || step.prompt || `Step ${index + 1}`}
          </button>
        ))}
        <button type="button" onClick={onAdd}>Add mock step</button>
        <button type="button" onClick={onMoveUp}>Move mock step up</button>
        <button type="button" onClick={onMoveDown}>Move mock step down</button>
        <button type="button" onClick={onRemove}>Remove mock step</button>
      </section>
    ),
    StepTaskSection: ({ step, onChange }: {
      step: { prompt: string };
      onChange: (patch: { title?: string; prompt?: string }) => void;
    }) => (
      <section aria-label="task-step">
        <span>{step.prompt || "missing prompt"}</span>
        <button type="button" onClick={() => onChange({ title: " Morning ", prompt: " Send report " })}>
          Set task
        </button>
      </section>
    ),
    StepParticipantSection: ({ step, onChange }: {
      step: { modelId: string };
      onChange: (patch: { modelId: string; selectedPersonaId: string | null }) => void;
    }) => (
      <section aria-label="participant-step">
        <span>{step.modelId || "missing model"}</span>
        <button type="button" onClick={() => onChange({ modelId: "openai/gpt-4o", selectedPersonaId: null })}>
          Choose tool model
        </button>
        <button type="button" onClick={() => onChange({ modelId: "anthropic/claude-3-haiku", selectedPersonaId: null })}>
          Choose no-tools model
        </button>
        <button type="button" onClick={() => onChange({ modelId: "google/gemini-pro", selectedPersonaId: null })}>
          Choose blocked Google model
        </button>
      </section>
    ),
    StepIntegrationsSection: ({ onChange }: { onChange: (patch: { gmailEnabled: boolean }) => void }) => (
      <section aria-label="integrations-step">
        <button type="button" onClick={() => onChange({ gmailEnabled: true })}>Enable Gmail</button>
      </section>
    ),
    StepSearchSection: () => <section aria-label="search-step" />,
    StepKnowledgeBaseSection: () => <section aria-label="kb-step" />,
    StepOptionsSection: () => <section aria-label="options-step" />,
    RecurrencePicker: ({ recurrenceType, cronExpression, onRecurrenceType, onCronExpression }: {
      recurrenceType: string;
      cronExpression: string;
      onRecurrenceType: (type: "manual" | "cron") => void;
      onCronExpression: (value: string) => void;
    }) => (
      <section aria-label="recurrence">
        <span>recurrence-{recurrenceType}</span>
        <button type="button" onClick={() => onRecurrenceType("manual")}>Use manual recurrence</button>
        <button type="button" onClick={() => onRecurrenceType("cron")}>Use cron recurrence</button>
        <input
          aria-label="cron expression"
          value={cronExpression}
          onChange={(event) => onCronExpression(event.target.value)}
        />
      </section>
    ),
  };
});

beforeEach(() => {
  mockState.mutationHookIndex = 0;
  mockState.createJob.mockReset();
  mockState.updateJob.mockReset();
  mockState.createJob.mockResolvedValue(null);
  mockState.updateJob.mockResolvedValue(null);
  mockState.remoteMcpConnections = [];
});

describe("ScheduledJobEditor shell", () => {
  it("builds create payloads from shell-owned state and blocks invalid cron saves", async () => {
    const onDone = vi.fn();
    render(<ScheduledJobEditor job={null} onDone={onDone} />);

    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/job name/i), { target: { value: "  Morning report  " } });
    fireEvent.click(screen.getByRole("button", { name: "Set task" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose tool model" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "folder_reports" } });
    fireEvent.click(screen.getByRole("button", { name: "Use cron recurrence" }));
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("cron expression"), { target: { value: "  0 8 * * *  " } });
    fireEvent.click(save);

    await waitFor(() => expect(mockState.createJob).toHaveBeenCalledTimes(1));
    expect(mockState.createJob).toHaveBeenCalledWith(expect.objectContaining({
      name: "Morning report",
      recurrence: { type: "cron", expression: "0 8 * * *" },
      targetFolderId: "folder_reports",
      createdBy: "user",
    }));
    const createCalls = mockState.createJob.mock.calls as unknown as Array<[{ steps: Array<Record<string, unknown>> }]>;
    const createArgs = createCalls[0]![0];
    expect(createArgs.steps[0]).toEqual(expect.objectContaining({
      title: "Morning",
      prompt: "Send report",
      modelId: "openai/gpt-4o",
    }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps save disabled when another selected step has incompatible integrations", () => {
    render(<ScheduledJobEditor job={null} onDone={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText(/job name/i), { target: { value: "Digest" } });
    fireEvent.click(screen.getByRole("button", { name: "Set task" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose blocked Google model" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable Gmail" }));
    fireEvent.click(screen.getByRole("button", { name: "Add mock step" }));

    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/Step 1|google/i);
    expect(mockState.createJob).not.toHaveBeenCalled();
  });

  it("updates existing jobs, surfaces save errors, and leaves navigation explicit", async () => {
    mockState.updateJob.mockRejectedValueOnce(new Error("backend unavailable"));
    const onDone = vi.fn();
    render(
      <ScheduledJobEditor
        onDone={onDone}
        job={{
          _id: "job_1" as Id<"scheduledJobs">,
          name: "Existing job",
          status: "active",
          targetFolderId: "folder_ops",
          recurrence: { type: "manual" },
          steps: [{ title: "Existing", prompt: "Already valid", modelId: "openai/gpt-4o" }],
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveValue("folder_ops");

    fireEvent.change(screen.getByPlaceholderText(/job name/i), { target: { value: "  Updated job  " } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(mockState.updateJob).toHaveBeenCalledTimes(1));
    expect(mockState.updateJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: "job_1",
      name: "Updated job",
      recurrence: { type: "manual" },
      targetFolderId: null,
    }));
    expect(screen.getByText(/backend unavailable/i)).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();

    mockState.updateJob.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

    fireEvent.click(within(screen.getByRole("heading", { name: /edit/i }).parentElement!).getAllByRole("button")[0]!);
    expect(onDone).toHaveBeenCalledTimes(2);
  });
});
