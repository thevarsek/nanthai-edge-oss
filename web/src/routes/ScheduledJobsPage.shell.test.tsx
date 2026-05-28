import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockState, renderRoute } from "@/test/criticalRoutesCoverage";
import { ScheduledJobsPage } from "./ScheduledJobsPage";

vi.mock("./ScheduledJobEditor", () => ({
  ScheduledJobEditor: ({ job, onDone }: { job?: { name: string }; onDone: () => void }) => (
    <div>
      <p>editor:{job?.name ?? "new"}</p>
      <button type="button" onClick={onDone}>editor done</button>
    </div>
  ),
}));

describe("ScheduledJobsPage shell behavior", () => {
  it("renders loading, empty, no-match, and settings-back states", () => {
    mockState.page = "scheduled";
    mockState.queryData.jobs = undefined;

    const first = renderRoute(<ScheduledJobsPage />);

    expect(screen.getByText("scheduled_jobs")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    first.unmount();

    mockState.queryData.jobs = [];
    renderRoute(<ScheduledJobsPage />);

    expect(screen.getByText("no_scheduled_jobs")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("search_generic_placeholder"), { target: { value: "missing" } });
    expect(screen.getByText("no_matching_jobs")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "back_to_settings" }));
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings");
  });

  it("covers list schedule variants, editor transitions, mutation errors, and delete recovery", async () => {
    const user = userEvent.setup();
    mockState.page = "scheduled";
    mockState.queryData.jobs = [
      { _id: "job_interval", name: "Interval job", status: "active", recurrence: { type: "interval", minutes: 15 }, steps: [{ prompt: "Ping", modelId: "openai/gpt-4.1" }] },
      { _id: "job_weekly", name: "Weekly job", status: "error", recurrence: { type: "weekly", dayOfWeek: 2, hourUTC: 9, minuteUTC: 5 }, lastRunError: "Cron failed", prompt: "Weekly", modelId: "openai/gpt-4.1" },
      { _id: "job_cron", name: "Cron job", status: "paused", recurrence: { type: "cron", expression: "0 9 * * 1" }, prompt: "Cron", modelId: "openai/gpt-4.1" },
    ];
    mockState.queryData.runs = [];
    mockState.queryData.triggerTokens = [];
    mockState.mutation
      .mockRejectedValueOnce(new Error("run failed"))
      .mockRejectedValueOnce(new Error("delete failed"))
      .mockResolvedValue(null);

    renderRoute(<ScheduledJobsPage />);

    expect(screen.getByText("schedule_every_minutes:15")).toBeInTheDocument();
    expect(screen.getByText("schedule_weekly_at")).toBeInTheDocument();
    expect(screen.getByText("schedule_cron")).toBeInTheDocument();

    await user.click(screen.getByText("Interval job"));
    await user.click(screen.getByText("run_now"));
    await waitFor(() => expect(mockState.toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "run failed",
      variant: "error",
    })));

    await user.click(screen.getByText("edit_job"));
    expect(screen.getByText("editor:Interval job")).toBeInTheDocument();
    await user.click(screen.getByText("editor done"));
    expect(screen.getAllByText("status_section")[0]).toBeInTheDocument();

    await user.click(screen.getByText("delete_job"));
    await user.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(mockState.toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "delete failed",
      variant: "error",
    })));

    await user.click(screen.getByRole("button", { name: "back" }));
    await user.click(screen.getByText("Cron job"));
    await user.click(screen.getByText("resume_job"));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ jobId: "job_cron" }));
  });

  it("handles active job controls, trigger keys, copied examples, and run history", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    mockState.page = "scheduled";
    mockState.queryData.jobs = [{
      _id: "job_api",
      name: "API job",
      status: "active",
      recurrence: { type: "daily", hourUTC: 7, minuteUTC: 30 },
      nextRunAt: Date.now() + 3_600_000,
      lastRunAt: Date.now() - 120_000,
      totalRuns: 2,
      createdBy: "ai",
      createdAt: 1_700_000_000_000,
      steps: [{
        title: "Digest",
        prompt: "Summarize {{TOPIC}} for {{AUDIENCE}}",
        modelId: "openai/gpt-4.1",
        enabledIntegrations: ["google_drive", "gmail"],
        turnIntegrationOverrides: [{ integrationId: "gmail", enabled: false }],
      }],
    }];
    mockState.queryData.runs = [
      { _id: "run_ok", status: "success", startedAt: 1_700_000_000_000, completedAt: 1_700_000_003_000, chatId: "chat_1" },
      { _id: "run_failed", status: "failed", startedAt: 1_700_000_004_000, error: "Timed out" },
    ];
    mockState.queryData.triggerTokens = [{
      _id: "token_1",
      label: "Automation key",
      tokenPrefix: "sk_live",
      status: "active",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    }];
    mockState.mutation
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ tokenId: "token_2", token: "secret-token", tokenPrefix: "sk_new" })
      .mockResolvedValueOnce(null);

    renderRoute(<ScheduledJobsPage />);

    await user.click(screen.getByRole("button", { name: /API job/ }));
    expect(screen.getByText("api_trigger_variables")).toBeInTheDocument();
    expect(screen.getByText("AUDIENCE, TOPIC")).toBeInTheDocument();
    expect(screen.getByText("Automation key")).toBeInTheDocument();
    expect(screen.getByText("runs_count:2")).toBeInTheDocument();
    expect(screen.getByText("Timed out")).toBeInTheDocument();

    await user.click(screen.getByText("pause_job"));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ jobId: "job_api" }));

    await user.click(screen.getByText("rotate_api_key"));
    await waitFor(() => expect(screen.getByText("secret-token")).toBeInTheDocument());

    await user.click(screen.getByText("copy_api_key"));
    expect(writeText).toHaveBeenCalledWith("secret-token");

    await user.click(screen.getByText("copy_curl_example"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"jobId\":\"job_api\""));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("<audience>"));

    await user.click(screen.getByText("copy_trigger_endpoint"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/scheduled-jobs/trigger"));

    await user.click(screen.getByText("revoke"));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ tokenId: "token_1" }));
  });
});
