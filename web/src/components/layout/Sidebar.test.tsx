import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { SharedDataContext, type SharedDataContextValue } from "@/hooks/useSharedData";
import { ToastProvider } from "@/components/shared/Toast";

const seededChats = [
  {
    _id: "chats_pinned",
    title: "Pinned strategy chat",
    lastMessagePreview: "Generated agreement is ready",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isPinned: true,
    pinnedAt: Date.now(),
    participantSummary: [],
  },
  {
    _id: "chats_recent",
    title: "Research notes",
    lastMessagePreview: "Knowledge Base summary",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isPinned: false,
    participantSummary: [],
  },
];

const seededFolders = [
  { _id: "folder_work", name: "Work", sortOrder: 1 },
];

const createChat = vi.fn();
const queryArgs: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    queryArgs.push(args);
    if (typeof args === "object" && args !== null && "limit" in args) return seededChats;
    return seededFolders;
  },
  useMutation: () => createChat,
}));

function renderSidebar() {
  const shellData = {
    prefs: { defaultModelId: "openai/gpt-4.1" },
    modelSettings: [],
    proStatus: { isPro: true, source: "manual" },
    accountCapabilities: { capabilities: [], isPro: true, hasMcpRuntime: false },
    personas: [],
    favorites: [],
  } as unknown as SharedDataContextValue;

  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <SharedDataContext.Provider value={shellData}>
        <ToastProvider>
          <Routes>
            <Route path="/app" element={<Sidebar />} />
            <Route path="/app/chat/:chatId" element={<Sidebar />} />
          </Routes>
        </ToastProvider>
      </SharedDataContext.Provider>
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    createChat.mockReset();
    queryArgs.length = 0;
  });

  test("renders seeded chat list rows without live Convex state", () => {
    renderSidebar();

    expect(screen.getByText("Pinned strategy chat")).toBeInTheDocument();
    expect(screen.getByText("Research notes")).toBeInTheDocument();
    expect(screen.getByText("Generated agreement is ready")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Base summary")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /presentations/i })).not.toBeInTheDocument();
  });

  test("ignores duplicate new-chat clicks and keyboard repeats while creation is pending", async () => {
    let resolveCreateChat: (chatId: string) => void = () => {};
    createChat.mockReturnValueOnce(new Promise((resolve) => {
      resolveCreateChat = resolve;
    }));

    renderSidebar();

    const button = screen.getByTitle(/new chat/i);
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "n", metaKey: true });

    expect(createChat).toHaveBeenCalledTimes(1);

    resolveCreateChat("chat_1");

    await waitFor(() => {
      expect(button).toHaveAttribute("aria-busy", "false");
    });
  });

  test("keeps folder and scheduled filters mutually exclusive", async () => {
    renderSidebar();

    fireEvent.click(screen.getByLabelText(/filter chats/i));
    fireEvent.click(screen.getByRole("button", { name: /work/i }));

    await waitFor(() => {
      expect(queryArgs.some((args) => (
        typeof args === "object" &&
        args !== null &&
        "folderId" in args &&
        (args as { folderId?: string }).folderId === "folder_work"
      ))).toBe(true);
    });

    fireEvent.click(screen.getByLabelText(/filter chats/i));
    fireEvent.click(screen.getByRole("button", { name: /scheduled/i }));

    await waitFor(() => {
      const latestChatArgs = queryArgs
        .filter((args) => typeof args === "object" && args !== null && "limit" in args)
        .at(-1) as { folderId?: string; source?: string } | undefined;
      expect(latestChatArgs?.folderId).toBeUndefined();
      expect(latestChatArgs?.source).toBe("scheduled_job");
    });
  });

  test("clearing search cancels the pending debounced query", async () => {
    vi.useFakeTimers();
    try {
      renderSidebar();

      const search = screen.getByRole("searchbox");
      fireEvent.change(search, { target: { value: "draft" } });
      fireEvent.click(screen.getByRole("button", { name: /clear search/i }));
      vi.advanceTimersByTime(350);

      const latestChatArgs = queryArgs
        .filter((args) => typeof args === "object" && args !== null && "limit" in args)
        .at(-1) as { searchQuery?: string } | undefined;
      expect(latestChatArgs?.searchQuery).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
