import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { mockState, renderRoute } from "@/test/criticalRoutesCoverage";
import { MemoryPage } from "./MemoryPage";

describe("MemoryPage shell behavior", () => {
  it("hides memory controls when disabled and routes settings/navigation actions", () => {
    mockState.page = "memory";
    mockState.queryData.memories = [];
    mockState.sharedData.prefs = { isMemoryEnabled: false, memoryGatingMode: "disabled" };

    renderRoute(<MemoryPage />);

    expect(screen.getByText("memory_enable")).toBeInTheDocument();
    expect(screen.queryByText("memory_saving_mode")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));
    expect(mockState.mutation).toHaveBeenCalledWith({ isMemoryEnabled: true });

    fireEvent.click(screen.getByRole("button", { name: "back_to_settings" }));
    expect(mockState.navigate).toHaveBeenCalledWith("/app/settings");
  });

  it("opens memory extraction with a text-output-only model catalog", () => {
    mockState.page = "memory";
    mockState.queryData.memories = [];
    mockState.sharedData.prefs = {
      isMemoryEnabled: true,
      memoryExtractionModelId: "image/free:free",
    };
    mockState.modelSummaries = [
      { modelId: "openai/gpt-4o", name: "GPT 4o" },
      { modelId: "image/free:free", name: "Free Image", supportsImages: true },
    ];

    renderRoute(<MemoryPage />);
    fireEvent.click(screen.getByText("memory_model_label"));

    expect(screen.getByText("GPT 4o")).toBeInTheDocument();
    expect(screen.queryByText("Free Image")).not.toBeInTheDocument();
    expect(screen.queryByText("selected")).not.toBeInTheDocument();
  });

  it("filters saved and pending memories and dispatches row actions with scoped ids", async () => {
    mockState.page = "memory";
    mockState.queryData.memories = [
      {
        _id: "mem_always",
        content: "Always remember keyboard shortcuts",
        category: "writingStyle",
        retrievalMode: "alwaysOn",
        scopeType: "selectedPersonas",
        tags: ["keyboard"],
        sourceFileName: "profile.md",
      },
      {
        _id: "mem_disabled",
        content: "Old disabled memory",
        category: "tools",
        retrievalMode: "disabled",
        scopeType: "allPersonas",
        tags: ["archive"],
      },
      {
        _id: "mem_pending",
        content: "Pending memory candidate",
        category: "work",
        retrievalMode: "contextual",
        scopeType: "allPersonas",
        isPending: true,
      },
    ];

    renderRoute(<MemoryPage />);

    fireEvent.click(screen.getByText("memory_view_all"));
    expect(screen.getByText("Always remember keyboard shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Old disabled memory")).toBeInTheDocument();
    expect(screen.getByText("Pending memory candidate")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "memory_retrieval_ignored" })[0]!);
    expect(screen.getByText("Old disabled memory")).toBeInTheDocument();
    expect(screen.queryByText("Always remember keyboard shortcuts")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "memory_retrieval_ignored" })[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "memory_scope_persona_specific" })[0]!);
    expect(screen.getByText("Always remember keyboard shortcuts")).toBeInTheDocument();
    expect(screen.queryByText("Old disabled memory")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "memory_scope_persona_specific" })[0]!);
    fireEvent.change(screen.getByPlaceholderText("Search memories or tags"), { target: { value: "pending" } });
    expect(screen.getByText("Pending memory candidate")).toBeInTheDocument();
    expect(screen.queryByText("Always remember keyboard shortcuts")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("memory_approve_title"));
    expect(mockState.mutation).toHaveBeenCalledWith({ memoryId: "mem_pending" });

    fireEvent.click(screen.getByText("all"));
    fireEvent.click(screen.getAllByTitle("delete")[0]!);
    fireEvent.click(screen.getAllByRole("button", { name: "delete" }).at(-1)!);
    await waitFor(() => expect(mockState.mutation).toHaveBeenCalledWith({ memoryId: "mem_pending" }));

    fireEvent.click(screen.getByText("memory_clear_all"));
    fireEvent.click(screen.getByRole("button", { name: "memory_delete_all" }));
    expect(mockState.mutation).toHaveBeenCalledWith({});
  });

  it("cleans up uploaded storage when memory extraction fails after upload", async () => {
    mockState.page = "memory";
    mockState.queryData.memories = [];
    mockState.mutation
      .mockResolvedValueOnce({ uploadUrl: "https://upload.example", uploadSessionId: "session_memory" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockState.action.mockRejectedValueOnce(new Error("extract failed"));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ storageId: "storage_import" }),
    })));

    renderRoute(<MemoryPage />);

    const uploadInput = document.querySelector("input[type='file']") as HTMLInputElement;
    fireEvent.change(uploadInput, { target: { files: [new File(["notes"], "notes.md", { type: "text/markdown" })] } });

    await waitFor(() => expect(screen.getByText(/upload_failed_arg/)).toBeInTheDocument());
    const mutationCalls = mockState.mutation.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const sessionCalls = mutationCalls.filter(([args]) =>
      args &&
      typeof args === "object" &&
      "storageId" in args &&
      args.storageId === "storage_import" &&
      "uploadSessionId" in args &&
      args.uploadSessionId === "session_memory",
    );
    expect(sessionCalls).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it("keeps delete dialogs open and visible when memory mutations fail", async () => {
    mockState.page = "memory";
    mockState.queryData.memories = [{
      _id: "mem_1",
      content: "Remember this",
      retrievalMode: "contextual",
      scopeType: "allPersonas",
      tags: [],
    }];
    mockState.mutation.mockRejectedValueOnce(new Error("delete failed"));

    renderRoute(<MemoryPage />);

    fireEvent.click(screen.getByText("memory_view_all"));
    fireEvent.click(screen.getByTitle("delete"));
    fireEvent.click(screen.getAllByRole("button", { name: "delete" }).at(-1)!);

    expect(await screen.findAllByText("delete failed")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    mockState.mutation.mockRejectedValueOnce(new Error("delete all failed"));
    fireEvent.click(screen.getByText("cancel"));
    fireEvent.click(screen.getByText("memory_clear_all"));
    fireEvent.click(screen.getByRole("button", { name: "memory_delete_all" }));

    expect(await screen.findAllByText("delete all failed")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
