import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TelegramConversationPicker } from "./TelegramConversationPicker";

const query = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useQuery: (_ref: unknown, args: { searchQuery: string; beforeChatId?: string }) => {
  query(args);
  if (args.searchQuery) return [{ _id: "older-search", title: "Older proposal" }];
  if (args.beforeChatId) return [{ _id: "oldest", title: "Oldest chat" }];
  return Array.from({ length: 21 }, (_, i) => ({ _id: `chat${i}`, title: `Chat ${i}` }));
} }));

describe("Telegram conversation picker", () => {
  it("shows 20 initial choices, loads an older page, and searches beyond the loaded page", () => {
    render(<TelegramConversationPicker value="" onChange={vi.fn()} disabled={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Pick a conversation" }));
    expect(screen.queryByRole("button", { name: "Chat 20" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load More" }));
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ order: "created", limit: 21, beforeChatId: "chat19" }));
    expect(screen.getByRole("button", { name: "Oldest chat" })).toBeVisible();
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "proposal" } });
    expect(query).toHaveBeenLastCalledWith(expect.objectContaining({ searchQuery: "proposal", beforeChatId: undefined }));
    expect(screen.getByRole("button", { name: "Older proposal" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Chat 0" })).toBeNull();
  });
});
