import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppEmptyState } from "./AppEmptyState";

const testState = vi.hoisted(() => ({
  navigate: vi.fn(),
  createChat: vi.fn(),
  toast: vi.fn(),
  sharedData: {
    prefs: { defaultModelId: "model_default" } as {
      defaultModelId?: string;
      defaultPersonaId?: string | null;
    } | null | undefined,
    personas: [] as Array<{
      _id: string;
      modelId?: string | null;
      displayName?: string | null;
      avatarEmoji?: string | null;
      avatarImageUrl?: string | null;
      temperature?: number | null;
      maxTokens?: number | null;
      includeReasoning?: boolean | null;
      reasoningEffort?: string | null;
    }> | undefined,
  },
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => testState.navigate,
}));

vi.mock("convex/react", () => ({
  useMutation: () => testState.createChat,
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => testState.sharedData,
}));

vi.mock("@/components/shared/Toast.context", () => ({
  useToast: () => ({ toast: testState.toast }),
}));

describe("AppEmptyState", () => {
  beforeEach(() => {
    testState.navigate.mockReset();
    testState.createChat.mockReset();
    testState.toast.mockReset();
    testState.sharedData.prefs = { defaultModelId: "model_default" };
    testState.sharedData.personas = [];
  });

  it("ignores duplicate new-chat clicks while creation is pending", async () => {
    testState.createChat.mockResolvedValueOnce("chat_1");

    render(<AppEmptyState />);

    const button = screen.getByRole("button", { name: /new chat/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(testState.createChat).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(testState.navigate).toHaveBeenCalledWith("/app/chat/chat_1");
    });
  });

  it("waits for personas before launching with a configured default persona", async () => {
    testState.sharedData.prefs = {
      defaultModelId: "model_default",
      defaultPersonaId: "persona_default",
    };
    testState.sharedData.personas = undefined;
    testState.createChat.mockResolvedValueOnce("chat_1");

    const { rerender } = render(<AppEmptyState />);

    const loadingButton = screen.getByRole("button", { name: /new chat/i });
    expect(loadingButton).toBeDisabled();
    fireEvent.click(loadingButton);
    expect(testState.createChat).not.toHaveBeenCalled();

    testState.sharedData.personas = [{
      _id: "persona_default",
      modelId: "persona_model",
      displayName: "Analyst",
      avatarEmoji: "A",
      avatarImageUrl: null,
      temperature: 0.4,
      maxTokens: 1024,
      includeReasoning: true,
      reasoningEffort: "medium",
    }];

    rerender(<AppEmptyState />);

    const readyButton = screen.getByRole("button", { name: /new chat/i });
    expect(readyButton).not.toBeDisabled();
    fireEvent.click(readyButton);

    await waitFor(() => {
      expect(testState.navigate).toHaveBeenCalledWith("/app/chat/chat_1");
    });
    expect(testState.createChat).toHaveBeenCalledWith({
      mode: "chat",
      participants: [{
        modelId: "persona_model",
        personaId: "persona_default",
        personaName: "Analyst",
        personaEmoji: "A",
        personaAvatarImageUrl: null,
        temperature: 0.4,
        maxTokens: 1024,
        includeReasoning: true,
        reasoningEffort: "medium",
      }],
    });
  });

  it("waits for preferences before launching with configured defaults", async () => {
    testState.sharedData.prefs = undefined;
    testState.sharedData.personas = [];
    testState.createChat.mockResolvedValueOnce("chat_1");

    const { rerender } = render(<AppEmptyState />);

    const loadingButton = screen.getByRole("button", { name: /new chat/i });
    expect(loadingButton).toBeDisabled();
    fireEvent.click(loadingButton);
    expect(testState.createChat).not.toHaveBeenCalled();

    testState.sharedData.prefs = { defaultModelId: "model_loaded" };

    rerender(<AppEmptyState />);

    const readyButton = screen.getByRole("button", { name: /new chat/i });
    expect(readyButton).not.toBeDisabled();
    fireEvent.click(readyButton);

    await waitFor(() => {
      expect(testState.navigate).toHaveBeenCalledWith("/app/chat/chat_1");
    });
    expect(testState.createChat).toHaveBeenCalledWith({
      mode: "chat",
      participants: [{
        modelId: "model_loaded",
        personaId: null,
      }],
    });
  });
});
