import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FavoritesStrip } from "./FavoritesStrip";

const navigate = vi.fn();
const createChat = vi.fn();
const toast = vi.fn();
let favorites: Array<Record<string, unknown>> = [
  {
    _id: "favorite_1",
    name: "Focus",
    modelIds: ["openai/gpt-4o"],
    sortOrder: 0,
    personaId: "persona_1",
  },
];

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
  useMutation: () => createChat,
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({
    favorites,
  }),
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast }),
}));

vi.mock("@/components/shared/PersonaAvatar", () => ({
  PersonaAvatar: ({ personaId }: { personaId?: string }) => <span>persona:{personaId}</span>,
}));

describe("FavoritesStrip", () => {
  beforeEach(() => {
    navigate.mockReset();
    createChat.mockReset();
    toast.mockReset();
    favorites = [
      {
        _id: "favorite_1",
        name: "Focus",
        modelIds: ["openai/gpt-4o"],
        sortOrder: 0,
        personaId: "persona_1",
      },
    ];
  });

  it("uses persona avatar fallback and ignores duplicate launch clicks while pending", async () => {
    createChat.mockResolvedValueOnce("chat_1");

    render(<FavoritesStrip />);

    const button = screen.getByRole("button", { name: /focus/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(createChat).toHaveBeenCalledTimes(1);
    expect(createChat).toHaveBeenCalledWith({
      mode: "chat",
      participants: [{
        modelId: "openai/gpt-4o",
        personaId: "persona_1",
        personaName: null,
        personaEmoji: null,
        personaAvatarImageUrl: null,
      }],
    });
    expect(screen.getByText("persona:persona_1")).toBeInTheDocument();

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/app/chat/chat_1");
    });
  });

  it("shows a toast when quick launch fails", async () => {
    createChat.mockRejectedValueOnce(new Error("Create failed"));

    render(<FavoritesStrip />);
    fireEvent.click(screen.getByRole("button", { name: /focus/i }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith({ message: "Create failed", variant: "error" });
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders multi-participant persona groups as a stack instead of a single persona", () => {
    favorites = [{
      _id: "favorite_2",
      name: "Panel",
      modelIds: ["anthropic/claude-sonnet-4", "openai/gpt-4o"],
      sortOrder: 0,
      personaId: "legacy_persona",
      personaEmoji: "L",
      participants: [
        {
          modelId: "anthropic/claude-sonnet-4",
          personaId: "persona_1",
          personaName: "Researcher",
          personaEmoji: "R",
          personaAvatarImageUrl: null,
        },
        {
          modelId: "openai/gpt-4o",
          personaId: null,
          personaName: null,
          personaEmoji: null,
          personaAvatarImageUrl: null,
        },
      ],
    }];

    render(<FavoritesStrip />);

    expect(screen.getByText("persona:persona_1")).toBeInTheDocument();
    expect(screen.queryByText("persona:legacy_persona")).not.toBeInTheDocument();
  });

  it("reveals scroll arrows when keyboard focus moves to them", async () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
    const scrollWidth = vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(300);
    const scrollLeft = vi.spyOn(HTMLElement.prototype, "scrollLeft", "get").mockReturnValue(0);

    render(<FavoritesStrip />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /scroll right/i })).toHaveClass("focus-visible:opacity-100");
    });

    clientWidth.mockRestore();
    scrollWidth.mockRestore();
    scrollLeft.mockRestore();
  });
});
