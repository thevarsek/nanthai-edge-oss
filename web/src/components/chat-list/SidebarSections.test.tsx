import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  EditModeBar,
  FilterMenu,
  FolderManagerDialog,
  PinnedSection,
  TimeGroupSection,
  type ChatRow,
  type FolderRow,
} from "./SidebarSections";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.var1 != null && options?.var2 != null ? `${options.var1} ${options.var2}` : key,
  }),
}));

vi.mock("@/components/chat-list/ChatListItem", () => ({
  ChatListItem: ({ chat, onSelect, onToggleCheck }: {
    chat: { _id: string; title?: string };
    onSelect: () => void;
    onToggleCheck?: () => void;
  }) => (
    <button type="button" onClick={onToggleCheck ?? onSelect}>
      {chat.title ?? "new_chat"}
    </button>
  ),
}));

const folders: FolderRow[] = [
  { _id: "folder_1" as Id<"folders">, name: "Projects" },
  { _id: "folder_2" as Id<"folders">, name: "Archive" },
];

function chat(id: string, title: string): ChatRow {
  return {
    _id: id as Id<"chats">,
    title,
    createdAt: 1,
    participantSummary: [{ modelId: "openai/gpt-4.1" }],
  };
}

const sectionHandlers = {
  onSelect: vi.fn(),
  onPin: vi.fn(),
  onDelete: vi.fn(),
  onMoveToFolder: vi.fn(),
};

describe("SidebarSections", () => {
  it("filters long folder menus and routes selected filter actions", () => {
    const onSelectAll = vi.fn();
    const onToggleScheduled = vi.fn();
    const onSelectFolder = vi.fn();
    const onManageFolders = vi.fn();
    const manyFolders = Array.from({ length: 9 }, (_, index) => ({
      _id: `folder_${index}` as Id<"folders">,
      name: index === 7 ? "Taxes" : `Folder ${index}`,
    }));

    render(
      <FilterMenu
        folders={manyFolders}
        selectedFolderId="folder_7"
        showScheduledOnly={false}
        onSelectAll={onSelectAll}
        onToggleScheduled={onToggleScheduled}
        onSelectFolder={onSelectFolder}
        onManageFolders={onManageFolders}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.change(screen.getByPlaceholderText("search_placeholder"), { target: { value: "tax" } });
    expect(screen.getByRole("button", { name: /Taxes/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Folder 1/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Taxes/ }));
    expect(onSelectFolder).toHaveBeenCalledWith("folder_7");
    expect(screen.queryByPlaceholderText("search_placeholder")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.click(screen.getByRole("button", { name: "all_chats" }));
    expect(onSelectAll).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.click(screen.getByRole("button", { name: "scheduled" }));
    expect(onToggleScheduled).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Filter chats" }));
    fireEvent.click(screen.getByRole("button", { name: "manage_folders" }));
    expect(onManageFolders).toHaveBeenCalledTimes(1);
  });

  it("manages folders through select, create, rename, delete, and close callbacks", () => {
    const onClose = vi.fn();
    const onSelectFolder = vi.fn();
    const onCreateFolder = vi.fn();
    const onRenameFolder = vi.fn();
    const onDeleteFolder = vi.fn();
    render(
      <FolderManagerDialog
        isOpen
        folders={folders}
        activeFolderId="folder_2"
        onClose={onClose}
        onSelectFolder={onSelectFolder}
        onCreateFolder={onCreateFolder}
        onRenameFolder={onRenameFolder}
        onDeleteFolder={onDeleteFolder}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "all_chats" }));
    expect(onSelectFolder).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("new_folder"));
    fireEvent.change(screen.getByPlaceholderText("folder_name_placeholder"), { target: { value: "  New work  " } });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    expect(onCreateFolder).toHaveBeenCalledWith("New work");

    const archiveRow = screen.getByText("Archive").closest(".group");
    if (!(archiveRow instanceof HTMLElement)) throw new Error("Missing Archive row");
    fireEvent.click(within(archiveRow).getByTitle("rename"));
    fireEvent.change(within(archiveRow).getByDisplayValue("Archive"), { target: { value: "Reference" } });
    fireEvent.click(within(archiveRow).getByRole("button", { name: "save" }));
    expect(onRenameFolder).toHaveBeenCalledWith("folder_2", "Reference");

    fireEvent.click(within(archiveRow).getByTitle("delete"));
    expect(onDeleteFolder).toHaveBeenCalledWith("folder_2");
  });

  it("collapses sections and reorders pinned chats by drag target", () => {
    const onReorderPinned = vi.fn();
    const chats = [chat("chat_a", "Alpha"), chat("chat_b", "Beta"), chat("chat_c", "Gamma")];
    const { rerender } = render(
      <TimeGroupSection
        {...sectionHandlers}
        label="Today"
        chats={chats}
        folders={folders}
        selectedChatId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.queryByRole("button", { name: "Alpha" })).not.toBeInTheDocument();

    rerender(
      <PinnedSection
        {...sectionHandlers}
        chats={chats}
        folders={folders}
        selectedChatId={null}
        isReorderMode
        onReorderPinned={onReorderPinned}
      />,
    );

    const alpha = screen.getByText("Alpha");
    const gamma = screen.getByText("Gamma");
    const dataTransfer = { dropEffect: "" };
    fireEvent.dragStart(alpha, { dataTransfer });
    fireEvent.dragOver(gamma, { dataTransfer });
    fireEvent.drop(gamma, { dataTransfer });

    expect(onReorderPinned).toHaveBeenCalledWith(["chat_b", "chat_c", "chat_a"]);
  });

  it("keeps edit mode bulk actions disabled until a row is selected", () => {
    const onMoveToFolder = vi.fn();
    const onDelete = vi.fn();
    const onDone = vi.fn();
    const { rerender } = render(
      <EditModeBar
        selectedCount={0}
        folders={folders}
        onMoveToFolder={onMoveToFolder}
        onDelete={onDelete}
        onDone={onDone}
      />,
    );

    expect(screen.getByRole("button", { name: "move" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "delete" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "done" }));
    expect(onDone).toHaveBeenCalledTimes(1);

    rerender(
      <EditModeBar
        selectedCount={2}
        folders={folders}
        onMoveToFolder={onMoveToFolder}
        onDelete={onDelete}
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "move" }));
    fireEvent.click(screen.getByRole("button", { name: "Projects" }));
    expect(onMoveToFolder).toHaveBeenCalledWith("folder_1");
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
