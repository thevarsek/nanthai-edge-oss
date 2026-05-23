import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppEmptyState } from "./AppEmptyState";

const navigate = vi.fn();
const createChat = vi.fn();

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
}));

vi.mock("convex/react", () => ({
  useMutation: () => createChat,
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ prefs: { defaultModelId: "model_default" }, personas: [] }),
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

describe("AppEmptyState", () => {
  it("ignores duplicate new-chat clicks while creation is pending", async () => {
    createChat.mockResolvedValueOnce("chat_1");

    render(<AppEmptyState />);

    const button = screen.getByRole("button", { name: /new chat/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(createChat).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/app/chat/chat_1");
    });
  });
});
