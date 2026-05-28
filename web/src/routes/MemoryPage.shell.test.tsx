import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
});
