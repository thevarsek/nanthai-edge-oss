import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdeascapePage } from "./IdeascapePage";

const { navigate, routeState, queryState } = vi.hoisted(() => ({
  navigate: vi.fn(),
  routeState: {
    chatId: undefined as string | undefined,
  },
  queryState: {
    chats: undefined as Array<{ _id: string; title?: string | null }> | undefined,
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useParams: () => ({ chatId: routeState.chatId }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: { chat: { queries: { listChats: "listChats" } } },
}));

vi.mock("convex/react", () => ({
  useQuery: () => queryState.chats,
}));

vi.mock("@/components/shared/LoadingSpinner", () => ({
  LoadingSpinner: () => <div role="status">loading</div>,
}));

vi.mock("@/routes/IdeascapePage.canvas", () => ({
  CanvasView: ({ chatId }: { chatId: string }) => <div>canvas:{chatId}</div>,
}));

describe("IdeascapePage route shell", () => {
  beforeEach(() => {
    navigate.mockClear();
    routeState.chatId = undefined;
    queryState.chats = undefined;
  });

  it("shows loading and empty picker fallback states when no chat is selected", () => {
    const { rerender } = render(<IdeascapePage />);

    expect(screen.getByRole("status")).toHaveTextContent("loading");

    queryState.chats = [];
    rerender(<IdeascapePage />);

    expect(screen.getByRole("heading", { name: "no_chats_yet_ideascape" })).toBeInTheDocument();
    expect(screen.getByText("start_chat_first")).toBeInTheDocument();
  });

  it("navigates to the selected chat from the picker and falls back to untitled labels", async () => {
    const user = userEvent.setup();
    queryState.chats = [
      { _id: "chat_named", title: "Roadmap" },
      { _id: "chat_untitled", title: null },
    ];

    render(<IdeascapePage />);

    expect(screen.getByRole("heading", { name: "choose_a_chat" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Roadmap/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /untitled/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Roadmap/ }));

    expect(navigate).toHaveBeenCalledWith("/app/ideascape/chat_named", { replace: true });
  });

  it("renders the active canvas from the route param and returns to chat", async () => {
    const user = userEvent.setup();
    routeState.chatId = "chat_from_url";

    render(<IdeascapePage />);

    expect(screen.getByText("canvas:chat_from_url")).toBeInTheDocument();

    await user.click(screen.getByTitle("back_to_chat"));

    expect(navigate).toHaveBeenCalledWith("/app/chat/chat_from_url");
  });
});
