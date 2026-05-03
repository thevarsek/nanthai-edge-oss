import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
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

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    if (typeof args === "object" && args !== null && "limit" in args) return seededChats;
    return [];
  },
  useMutation: () => vi.fn(),
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
          </Routes>
        </ToastProvider>
      </SharedDataContext.Provider>
    </MemoryRouter>,
  );
}

describe("Sidebar", () => {
  test("renders seeded chat list rows without live Convex state", () => {
    renderSidebar();

    expect(screen.getByText("Pinned strategy chat")).toBeInTheDocument();
    expect(screen.getByText("Research notes")).toBeInTheDocument();
    expect(screen.getByText("Generated agreement is ready")).toBeInTheDocument();
    expect(screen.getByText("Knowledge Base summary")).toBeInTheDocument();
  });
});
