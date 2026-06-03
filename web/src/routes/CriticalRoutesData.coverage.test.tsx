import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import {
  mockMutationEndpoint,
  mockQueryEndpoint,
  mockState,
  renderRoute,
} from "@/test/criticalRoutesCoverage";
import { KnowledgeBasePage } from "./KnowledgeBasePage";
import { ManageFavoritesPage } from "./ManageFavoritesPage";
import { MemoryPage } from "./MemoryPage";
import { ScheduledJobsPage } from "./ScheduledJobsPage";

describe("critical data route coverage", () => {
  it("covers Memory loading, pending review actions, search, and preference mutation args", async () => {
    mockState.page = "memory";
    mockState.queryData.memories = [
      {
        _id: "mem_saved",
        content: "Prefers concise plans",
        category: "preferences",
        retrievalMode: "alwaysOn",
        scopeType: "allPersonas",
        tags: ["planning"],
        isPinned: false,
        isPending: false,
      },
      {
        _id: "mem_pending",
        content: "Review this memory",
        category: "work",
        retrievalMode: "contextual",
        scopeType: "allPersonas",
        tags: ["review"],
        isPinned: true,
        isPending: true,
      },
    ];

    renderRoute(<MemoryPage />);

    expect(screen.getAllByText("memory_pending_review")[0]).toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch"));
    expect(mockState.mutation).toHaveBeenCalledWith({ isMemoryEnabled: false });
    fireEvent.click(screen.getByText("memory_view_all"));
    fireEvent.click(screen.getByText("approve_all"));
    expect(mockState.mutation).toHaveBeenCalledWith({});
    expect(screen.getByText("Prefers concise plans")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search memories or tags"), { target: { value: "concise" } });
    expect(screen.getByText("Prefers concise plans")).toBeInTheDocument();
    expect(screen.queryByText("Review this memory")).not.toBeInTheDocument();
  });

  it("covers Knowledge Base populated states, source filters, upload, delete, and Drive import guards", async () => {
    mockState.page = "kb";
    mockState.queryData.folders = [{ _id: "folder_1", name: "Specs" }];
    mockState.queryData.files = [{
      storageId: "storage_1",
      fileAttachmentId: "file_1",
      filename: "roadmap.pdf",
      source: "upload",
      sizeBytes: 2048,
      createdAt: Date.now(),
      downloadUrl: "https://example.com/roadmap.pdf",
      mimeType: "application/pdf",
      isReadableDocument: true,
      documentExtractionStatus: "ready",
    }];
    mockState.mutation
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example", uploadSessionId: "session_1" })
      .mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ storageId: "storage_upload" }),
    })));

    const { rerender } = renderRoute(<KnowledgeBasePage />);

    expect(screen.getByText("roadmap.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByText("drive_source"));
    expect(screen.getByText("roadmap.pdf")).toBeInTheDocument();

    const uploadInput = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(uploadInput, { target: { files: [new File(["hello"], "notes.md", { type: "text/markdown" })] } });
    await waitFor(() => {
      expect(mockState.mutation).toHaveBeenCalledWith(expect.objectContaining({
        filename: "notes.md",
        storageId: "storage_upload",
      }));
    });

    fireEvent.click(screen.getByTitle("delete"));
    fireEvent.click(screen.getAllByRole("button", { name: "delete" }).at(-1)!);
    expect(mockState.mutation).toHaveBeenCalledWith({
      storageId: "storage_1",
      fileAttachmentId: "file_1",
      source: "upload",
    });

    mockState.connectedAccounts = { ...mockState.connectedAccounts, googleConnection: null };
    rerender(
      <MemoryRouter initialEntries={["/app/settings/test"]}>
        <KnowledgeBasePage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("import_from_drive"));
    expect(mockState.toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "connect_google_drive_before_choosing_files",
      variant: "error",
    }));

    vi.unstubAllGlobals();
  });

  it("covers Scheduled Jobs list, detail actions, runs, trigger tokens, and mutation args", async () => {
    const user = userEvent.setup();
    mockState.page = "scheduled";
    mockState.queryData.jobs = [
      {
        _id: "job_1",
        name: "Morning summary",
        status: "active",
        recurrence: { type: "daily", hourUTC: 8, minuteUTC: 30 },
        steps: [{ title: "Summarize", prompt: "Summarize {{topic}}", modelId: "openai/gpt-4.1" }],
        nextRunAt: Date.now() + 120_000,
        lastRunAt: Date.now() - 120_000,
        totalRuns: 3,
        createdBy: "ai",
        createdAt: Date.now() - 86_400_000,
      },
      { _id: "job_2", name: "Paused digest", status: "paused", recurrence: { type: "manual" } },
    ];
    mockState.queryData.runs = [{ _id: "run_1", status: "failed", startedAt: Date.now() - 10_000, error: "Provider failed" }];
    mockState.queryData.triggerTokens = [{ _id: "token_1", tokenPrefix: "ntp_live", status: "active", createdAt: Date.now(), updatedAt: Date.now() }];

    renderRoute(<ScheduledJobsPage />);

    expect(screen.getByText("Morning summary")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("search_generic_placeholder"), { target: { value: "paused" } });
    expect(screen.getByText("Paused digest")).toBeInTheDocument();
    expect(screen.queryByText("Morning summary")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("search_generic_placeholder"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Morning summary"));
    expect(screen.getByText("api_trigger_variables")).toBeInTheDocument();
    expect(screen.getByText("Provider failed")).toBeInTheDocument();

    await user.click(screen.getByText("run_now"));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ jobId: "job_1" }));
    await user.click(screen.getByText("pause_job"));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ jobId: "job_1" }));
    await user.click(screen.getByText("delete_job"));
    await user.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ jobId: "job_1" }));
  });

  it("covers Memory file import, extraction errors, and imported candidate commit args", async () => {
    mockState.page = "memory";
    mockState.queryData.memories = [];
    mockState.sharedData.prefs = {
      isMemoryEnabled: true,
      memoryExtractionModelId: "anthropic/claude-sonnet-4.5",
    };
    mockState.mutation
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example", uploadSessionId: "session_import" })
      .mockResolvedValue(null);
    mockState.action.mockResolvedValueOnce([
      {
        content: "Uses short planning docs",
        category: "work",
        retrievalMode: "contextual",
        scopeType: "selectedPersonas",
        personaIds: ["persona_1"],
        tags: ["planning"],
        isPinned: true,
        sourceFileName: "notes.md",
        importanceScore: 0.8,
        confidenceScore: 0.9,
      },
    ]);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ storageId: "storage_import" }),
    })));

    renderRoute(<MemoryPage />);

    const uploadInput = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(uploadInput, { target: { files: [new File(["notes"], "notes.md", { type: "text/markdown" })] } });

    await waitFor(() => expect(mockState.action).toHaveBeenCalledWith({
      files: [{ storageId: "storage_import", filename: "notes.md", mimeType: "text/markdown" }],
      extractionModel: "anthropic/claude-sonnet-4.5",
    }));
    expect(screen.getByText("Uses short planning docs")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({
      memories: [expect.objectContaining({
        content: "Uses short planning docs",
        personaIds: ["persona_1"],
        sourceFileName: "notes.md",
      })],
    }));

    vi.unstubAllGlobals();
  });

  it("covers Scheduled Jobs API trigger creation, copy affordances, and paused resume path", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    mockState.page = "scheduled";
    mockState.strictEndpoints = true;
    const jobs = [{
      _id: "job_manual",
      name: "Manual trigger",
      status: "paused",
      recurrence: { type: "manual" },
      prompt: "Draft report for {{Client}}",
      modelId: "openai/gpt-4.1",
      createdBy: "user",
    }];
    mockQueryEndpoint("scheduledJobs/queries:list", jobs);
    mockQueryEndpoint("scheduledJobs/queries:listRuns", []);
    mockQueryEndpoint("scheduledJobs/queries:listJobTriggerTokens", []);
    const createTriggerToken = mockMutationEndpoint("scheduledJobs/mutations:createJobTriggerToken", async () => ({
      tokenId: "token_new",
      token: "ntp_secret_value",
      tokenPrefix: "ntp_secret",
    }));
    const resumeJob = mockMutationEndpoint("scheduledJobs/mutations:resumeJob");
    mockMutationEndpoint("scheduledJobs/mutations:rotateJobTriggerToken");
    mockMutationEndpoint("scheduledJobs/mutations:revokeJobTriggerToken");
    mockMutationEndpoint("scheduledJobs/mutations:deleteJob");
    mockMutationEndpoint("scheduledJobs/mutations:pauseJob");
    mockMutationEndpoint("scheduledJobs/mutations:runJobNow");

    renderRoute(<ScheduledJobsPage />);

    await user.click(screen.getByText("Manual trigger"));
    expect(screen.getByText("no_active_api_trigger_key")).toBeInTheDocument();
    expect(screen.getByText("api_trigger_variables")).toBeInTheDocument();
    expect(screen.getByText("Client")).toBeInTheDocument();

    await user.click(screen.getByText("generate_api_key"));
    await waitFor(() => expect(screen.getByText("ntp_secret_value")).toBeInTheDocument());
    expect(createTriggerToken).toHaveBeenCalledWith({ jobId: "job_manual" });

    await user.click(screen.getByText("copy_api_key"));
    expect(writeText).toHaveBeenCalledWith("ntp_secret_value");

    await user.click(screen.getByText("copy_curl_example"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('"Client":"<client>"'));

    await user.click(screen.getByText("resume_job"));
    await waitFor(() => expect(resumeJob).toHaveBeenCalledWith({ jobId: "job_manual" }));
  });

  it("covers Favorites populated rows, reorder, delete, and editor open states", async () => {
    mockState.sharedData.favorites = [
      { _id: "fav_2", name: "Second", sortOrder: 2, modelIds: ["anthropic/claude-sonnet-4.5"] },
      { _id: "fav_1", name: "First", sortOrder: 1, modelIds: ["openai/gpt-4.1"] },
    ];

    renderRoute(<ManageFavoritesPage />);

    expect(screen.getByText("First")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("delete")[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "delete" }).at(-1)!);
    expect(mockState.mutation).toHaveBeenCalledWith({ favoriteId: "fav_1" });

    fireEvent.click(screen.getByText("reorder"));
    fireEvent.click(screen.getAllByRole("button").find((button) => button.innerHTML.includes("polyline points=\"2 4 6 8 10 4\""))!);
    fireEvent.click(screen.getByText("done"));
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ orderedIds: ["fav_2", "fav_1"] }));
    await waitFor(() => expect(screen.getByText("add_favorite")).toBeInTheDocument());

    fireEvent.click(screen.getByText("add_favorite"));
    expect(screen.getByText("new_favorite")).toBeInTheDocument();
  });
});
