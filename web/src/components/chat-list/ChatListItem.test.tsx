import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatListItem, type ChatListItemData } from "./ChatListItem";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/shared/ProviderLogo", () => ({
  ProviderLogo: ({ modelId }: { modelId: string }) => <span>logo-{modelId}</span>,
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaName }: { personaName?: string }) => <span>persona-{personaName}</span>,
}));

const baseChat: ChatListItemData = {
  _id: "chat_1",
  title: "Quarterly planning",
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_060_000,
  lastMessagePreview: "A concise summary for the row preview",
  participantSummary: [{ modelId: "openai/gpt-4.1" }],
};

function renderItem(overrides: Partial<ComponentProps<typeof ChatListItem>> = {}) {
  const props = {
    chat: baseChat,
    isSelected: false,
    folders: [{ _id: "folder_1", name: "Work" }],
    onSelect: vi.fn(),
    onPin: vi.fn(),
    onDelete: vi.fn(),
    onMoveToFolder: vi.fn(),
    onRename: vi.fn(),
    onDuplicate: vi.fn(),
    onEnterEditMode: vi.fn(),
    onToggleCheck: vi.fn(),
    ...overrides,
  };
  const view = render(<ChatListItem {...props} />);
  return { ...props, ...view };
}

function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: "chat_options" }));
}

describe("ChatListItem", () => {
  it("selects chats in normal mode and toggles checks in edit mode", () => {
    const normal = renderItem();
    fireEvent.click(screen.getByText("Quarterly planning"));
    expect(normal.onSelect).toHaveBeenCalledTimes(1);
    expect(normal.onToggleCheck).not.toHaveBeenCalled();
    normal.unmount();

    const edit = renderItem({ isEditMode: true, isChecked: true });
    fireEvent.keyDown(screen.getByText("Quarterly planning"), { key: "Enter" });
    expect(edit.onToggleCheck).toHaveBeenCalledTimes(1);
    expect(edit.onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "chat_options" })).not.toBeInTheDocument();
  });

  it("renders scheduled metadata ahead of folder and preview metadata", () => {
    renderItem({
      chat: {
        ...baseChat,
        folderName: "Research",
        sourceJobName: "Daily digest",
      },
    });

    expect(screen.getByText("Daily digest")).toBeInTheDocument();
    expect(screen.queryByText("Research")).not.toBeInTheDocument();
    expect(screen.queryByText("A concise summary for the row preview")).not.toBeInTheDocument();
  });

  it("runs context menu actions with scoped folder choices", () => {
    const props = renderItem({
      chat: {
        ...baseChat,
        isPinned: true,
      },
    });

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "unpin" }));
    expect(props.onPin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "rename" })).not.toBeInTheDocument();

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    expect(props.onRename).toHaveBeenCalledTimes(1);

    openMenu();
    const menu = screen.getByText("move_to_folder").closest(".absolute");
    if (!(menu instanceof HTMLElement)) throw new Error("Missing context menu");
    fireEvent.click(within(menu).getByRole("button", { name: "no_folder" }));
    expect(props.onMoveToFolder).toHaveBeenCalledWith(undefined);

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Work" }));
    expect(props.onMoveToFolder).toHaveBeenCalledWith("folder_1");

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "duplicate" }));
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "select_chats" }));
    expect(props.onEnterEditMode).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });
});
