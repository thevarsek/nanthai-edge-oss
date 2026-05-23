import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, test, vi, beforeEach } from "vitest";
import { PersonasPage } from "./PersonasPage";
import { SharedDataContext, type SharedDataContextValue } from "@/hooks/useSharedData";
import { ToastProvider } from "@/components/shared/Toast";

const createChat = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => createChat,
}));

vi.mock("@/hooks/useProGate.hook", () => ({
  useProGate: () => ({ isPro: true }),
}));

function renderPersonasPage() {
  const shellData = {
    personas: [
      {
        _id: "persona_1",
        displayName: "Researcher",
        personaDescription: "Checks sources",
        modelId: "openai/gpt-4.1",
        systemPrompt: "Verify carefully.",
      },
    ],
  } as unknown as SharedDataContextValue;

  return render(
    <MemoryRouter initialEntries={["/app/personas"]}>
      <SharedDataContext.Provider value={shellData}>
        <ToastProvider>
          <Routes>
            <Route path="/app/personas" element={<PersonasPage />} />
            <Route path="/app/chat/:chatId" element={<div>chat route</div>} />
          </Routes>
        </ToastProvider>
      </SharedDataContext.Provider>
    </MemoryRouter>,
  );
}

describe("PersonasPage", () => {
  beforeEach(() => {
    createChat.mockReset();
  });

  test("ignores duplicate persona new-chat clicks while creation is pending", async () => {
    let resolveCreateChat: (chatId: string) => void = () => {};
    createChat.mockReturnValueOnce(new Promise((resolve) => {
      resolveCreateChat = resolve;
    }));

    renderPersonasPage();

    const button = screen.getByRole("button", { name: /new chat/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(createChat).toHaveBeenCalledTimes(1);

    resolveCreateChat("chat_1");

    await waitFor(() => {
      expect(screen.getByText("chat route")).toBeInTheDocument();
    });
  });
});
