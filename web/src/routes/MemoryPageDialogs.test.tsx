import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { ImportReviewDialog, MemoryEditorDialog } from "./MemoryPageDialogs";
import type { ImportedMemoryCandidate, MemoryDoc } from "./MemoryPageHelpers";

const createManual = vi.fn();
const updateMemory = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: (target: unknown) => {
    const path = String(target);
    return path.includes("update") ? updateMemory : createManual;
  },
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    memory: {
      operations: {
        createManual: "memory.operations.createManual",
        update: "memory.operations.update",
      },
    },
  },
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({
    personas: [
      { _id: "persona_1", displayName: "Researcher" },
      { _id: "persona_2", displayName: "Coach" },
    ],
  }),
}));

function memory(overrides: Partial<MemoryDoc> = {}): MemoryDoc {
  return {
    _id: "memory_1" as Id<"memories">,
    content: "Use concise status updates",
    category: "work",
    retrievalMode: "contextual",
    scopeType: "allPersonas",
    personaIds: [],
    tags: ["style"],
    isPinned: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<ImportedMemoryCandidate> = {}): ImportedMemoryCandidate {
  return {
    content: "Prefers direct answers",
    category: "preferences",
    retrievalMode: "alwaysOn",
    scopeType: "allPersonas",
    tags: ["voice"],
    isPinned: false,
    sourceFileName: "notes.md",
    importanceScore: 0.8,
    confidenceScore: 0.6,
    ...overrides,
  };
}

describe("MemoryPageDialogs", () => {
  beforeEach(() => {
    createManual.mockReset();
    updateMemory.mockReset();
    createManual.mockResolvedValue(undefined);
    updateMemory.mockResolvedValue(undefined);
  });

  it("creates manual memories with normalized tags, selected personas, and pinned state", async () => {
    const onClose = vi.fn();
    render(<MemoryEditorDialog onClose={onClose} />);

    fireEvent.change(screen.getByPlaceholderText("memory_content_placeholder"), {
      target: { value: "  Remember timezone is London  " },
    });
    fireEvent.change(screen.getByDisplayValue("memory_cat_none"), { target: { value: "logistics" } });
    fireEvent.change(screen.getByDisplayValue("memory_retrieval_contextual"), { target: { value: "alwaysOn" } });
    fireEvent.change(screen.getByDisplayValue("memory_scope_all_personas"), { target: { value: "selectedPersonas" } });
    fireEvent.click(screen.getByRole("button", { name: "Researcher" }));
    fireEvent.change(screen.getByPlaceholderText("work, style, travel"), { target: { value: " travel, , timezone " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "memory_pin_label" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(createManual).toHaveBeenCalledWith({
      content: "Remember timezone is London",
      category: "logistics",
      retrievalMode: "alwaysOn",
      scopeType: "selectedPersonas",
      personaIds: ["persona_1"],
      tags: ["travel", "timezone"],
      isPinned: true,
      sourceFileName: undefined,
      importanceScore: undefined,
      confidenceScore: undefined,
    }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("updates existing memories and keeps the dialog open on save failure", async () => {
    updateMemory.mockRejectedValueOnce(new Error("nope"));
    const onClose = vi.fn();
    render(<MemoryEditorDialog memory={memory()} onClose={onClose} />);

    fireEvent.change(screen.getByDisplayValue("Use concise status updates"), {
      target: { value: "Use bullet summaries" },
    });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateMemory).toHaveBeenCalledWith(expect.objectContaining({
      memoryId: "memory_1",
      content: "Use bullet summaries",
      category: "work",
      tags: ["style"],
    })));
    expect(await screen.findByText("memory_save_error")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sends an explicit null category when editing clears an existing category", async () => {
    const onClose = vi.fn();
    render(<MemoryEditorDialog memory={memory()} onClose={onClose} />);

    fireEvent.change(screen.getByDisplayValue("memory_cat_work"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(updateMemory).toHaveBeenCalledWith(expect.objectContaining({
      memoryId: "memory_1",
      category: null,
    })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("reviews imported candidates, preserves scores, filters blank entries, and reports save errors", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("failed"));
    render(
      <ImportReviewDialog
        candidates={[
          candidate(),
          candidate({ content: "Will be blanked", sourceFileName: "empty.md", tags: ["drop"] }),
        ]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const firstCard = screen.getByText("notes.md").closest(".rounded-2xl");
    if (!(firstCard instanceof HTMLElement)) throw new Error("Missing first candidate card");
    fireEvent.change(within(firstCard).getByDisplayValue("Prefers direct answers"), {
      target: { value: "Prefers crisp answers" },
    });
    fireEvent.change(within(firstCard).getByDisplayValue("memory_scope_all_personas"), {
      target: { value: "selectedPersonas" },
    });
    fireEvent.click(within(firstCard).getByRole("button", { name: "Coach" }));

    const secondCard = screen.getByText("empty.md").closest(".rounded-2xl");
    if (!(secondCard instanceof HTMLElement)) throw new Error("Missing second candidate card");
    fireEvent.change(within(secondCard).getByDisplayValue("Will be blanked"), { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith([expect.objectContaining({
      content: "Prefers crisp answers",
      category: "preferences",
      retrievalMode: "alwaysOn",
      scopeType: "selectedPersonas",
      personaIds: ["persona_2"],
      tags: ["voice"],
      sourceFileName: "notes.md",
      importanceScore: 0.8,
      confidenceScore: 0.6,
    })]));
    expect(await screen.findByText("memory_save_error")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Prefers crisp answers")).toBeInTheDocument();
  });
});
