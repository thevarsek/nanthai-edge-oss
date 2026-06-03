import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockState, renderRoute } from "@/test/criticalRoutesCoverage";
import { KnowledgeBasePage } from "./KnowledgeBasePage";

describe("KnowledgeBasePage shell behavior", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("renders loading, empty search, and settings navigation states", () => {
    mockState.page = "kb";
    mockState.queryData.folders = [];
    mockState.queryData.files = undefined;

    const loading = renderRoute(<KnowledgeBasePage />);

    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
    loading.unmount();

    mockState.queryData.files = [];
    renderRoute(<KnowledgeBasePage />);

    expect(screen.getByText("no_files_yet")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("search_placeholder"), { target: { value: "missing" } });
    expect(screen.getByText("no_files_found")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "back_to_settings" }));
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings");
  });

  it("handles upload failures and Drive version edge actions", async () => {
    const user = userEvent.setup();
    mockState.page = "kb";
    mockState.queryData.folders = [{ _id: "folder_specs", name: "Specs" }];
    mockState.queryData.files = [{
      storageId: "storage_drive",
      fileAttachmentId: "file_drive",
      filename: "drive-plan.pdf",
      source: "drive",
      sizeBytes: 4096,
      createdAt: Date.now(),
      mimeType: "application/pdf",
      documentId: "doc_1",
      documentExtractionStatus: "failed",
      documentSyncState: "external_update_available",
      documentExternalSyncedVersionId: "version_2",
      documentExternalSyncedDownloadUrl: null,
      isReadableDocument: true,
    }];
    mockState.mutation.mockRejectedValueOnce(new Error("make current failed"));

    renderRoute(<KnowledgeBasePage />);

    expect(screen.getByText("drive-plan.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Specs"));
    fireEvent.click(screen.getByText("unfiled"));

    await user.click(screen.getByTitle("view_drive_version"));
    expect(mockState.toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "something_went_wrong",
      variant: "error",
    }));

    await user.click(screen.getByTitle("make_current"));
    await waitFor(() => expect(mockState.toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "make current failed",
      variant: "error",
    })));

    const uploadInput = document.querySelector("input[type='file']") as HTMLInputElement;
    const tooLarge = new File(["x"], "huge.pdf", { type: "application/pdf" });
    Object.defineProperty(tooLarge, "size", { value: 26 * 1024 * 1024 });
    fireEvent.change(uploadInput, { target: { files: [tooLarge] } });

    await waitFor(() => expect(screen.getByText(/upload_failed_arg/)).toBeInTheDocument());
  });

  it("imports Drive picks sequentially and reports partial failures", async () => {
    const user = userEvent.setup();
    vi.stubEnv("VITE_GOOGLE_PICKER_API_KEY", "dev-key");
    vi.stubEnv("VITE_GOOGLE_PICKER_APP_ID", "dev-app");
    mockState.page = "kb";
    mockState.queryData.folders = [];
    mockState.queryData.files = [];
    mockState.connectedAccounts = {
      ...mockState.connectedAccounts,
      googleConnection: { hasDrive: true },
    };
    mockState.action
      .mockResolvedValueOnce({ accessToken: "drive-token" })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("Drive failed"));
    mockState.pickGoogleDriveFiles.mockResolvedValueOnce([
      { id: "drive_ok", name: "OK Doc", mimeType: "application/pdf" },
      { id: "drive_bad", name: "Bad Doc", mimeType: "application/pdf" },
    ]);

    renderRoute(<KnowledgeBasePage />);

    await user.click(screen.getByRole("button", { name: "import_from_drive" }));

    await waitFor(() => expect(mockState.action).toHaveBeenCalledWith({ fileId: "drive_ok" }));
    expect(mockState.action).toHaveBeenCalledWith({ fileId: "drive_bad" });
    expect(mockState.toast).toHaveBeenCalledWith(expect.objectContaining({
      message: "kb_drive_import_succeeded:1",
      variant: "success",
    }));
    expect(mockState.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: "error",
    }));
  });

  it("cleans up uploaded storage when KB registration fails after upload", async () => {
    mockState.page = "kb";
    mockState.queryData.folders = [];
    mockState.queryData.files = [];
    mockState.mutation
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example", uploadSessionId: "session_fail" })
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("registration failed"))
      .mockResolvedValueOnce(null);
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ storageId: "storage_orphan" }),
    })));

    renderRoute(<KnowledgeBasePage />);

    const uploadInput = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(uploadInput, { target: { files: [new File(["hello"], "orphan.md", { type: "text/markdown" })] } });

    await waitFor(() => expect(screen.getByText(/upload_failed_arg/)).toBeInTheDocument());
    const mutationCalls = mockState.mutation.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const sessionCalls = mutationCalls.filter(([args]) =>
      args &&
      typeof args === "object" &&
      "storageId" in args &&
      args.storageId === "storage_orphan" &&
      "uploadSessionId" in args &&
      args.uploadSessionId === "session_fail" &&
      !("filename" in args),
    );
    expect(sessionCalls).toHaveLength(2);
  });

  it("keeps the KB delete confirmation open and shows the backend failure", async () => {
    mockState.page = "kb";
    mockState.queryData.folders = [];
    mockState.queryData.files = [{
      storageId: "storage_1",
      fileAttachmentId: "file_1",
      filename: "roadmap.pdf",
      source: "upload",
      sizeBytes: 2048,
      createdAt: Date.now(),
      mimeType: "application/pdf",
    }];
    mockState.mutation.mockRejectedValueOnce(new Error("delete failed"));

    renderRoute(<KnowledgeBasePage />);

    fireEvent.click(screen.getByTitle("delete"));
    fireEvent.click(screen.getAllByRole("button", { name: "delete" }).at(-1)!);

    expect(await screen.findAllByText("delete failed")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
