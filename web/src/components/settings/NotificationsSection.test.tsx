import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsSection } from "./NotificationsSection";

const enable = vi.fn();
const upsertPreferences = vi.fn();
let serverChatCompletionEnabled = false;
let isRegistered = false;

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ prefs: { chatCompletionNotificationsEnabled: serverChatCompletionEnabled } }),
}));

vi.mock("@/hooks/useProGate.hook", () => ({
  useProGate: () => ({ isPro: true }),
}));

vi.mock("@/hooks/useWebPush", () => ({
  useWebPush: () => ({
    status: "idle",
    isRegistered,
    isSupported: true,
    isConfigured: true,
    enable,
    disable: vi.fn(),
  }),
}));

vi.mock("convex/react", () => ({
  useMutation: () => upsertPreferences,
}));

describe("NotificationsSection", () => {
  beforeEach(() => {
    enable.mockReset();
    upsertPreferences.mockReset();
    upsertPreferences.mockResolvedValue(undefined);
    serverChatCompletionEnabled = false;
    isRegistered = false;
  });

  it("reenables the enable button when web push enable rejects", async () => {
    enable.mockRejectedValueOnce(new Error("permission failed"));

    render(<NotificationsSection />);

    const button = screen.getByRole("button", { name: /enable push notifications/i });
    fireEvent.click(button);

    expect(button).toBeDisabled();

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it("keeps the latest optimistic chat notification toggle through stale server echoes", async () => {
    isRegistered = true;
    const { rerender } = render(<NotificationsSection />);
    const chatToggle = screen.getAllByRole("switch")[2];

    fireEvent.click(chatToggle);
    expect(chatToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(chatToggle);
    expect(chatToggle).toHaveAttribute("aria-checked", "false");

    serverChatCompletionEnabled = true;
    rerender(<NotificationsSection />);
    expect(screen.getAllByRole("switch")[2]).toHaveAttribute("aria-checked", "false");

    serverChatCompletionEnabled = false;
    rerender(<NotificationsSection />);
    expect(screen.getAllByRole("switch")[2]).toHaveAttribute("aria-checked", "false");

    await waitFor(() => {
      expect(upsertPreferences).toHaveBeenCalledTimes(2);
    });
  });

  it("clears a completed no-op chat notification toggle before accepting later server changes", async () => {
    isRegistered = true;
    const { rerender } = render(<NotificationsSection />);
    const chatToggle = screen.getAllByRole("switch")[2];

    fireEvent.click(chatToggle);
    expect(chatToggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(chatToggle);
    expect(chatToggle).toHaveAttribute("aria-checked", "false");

    await waitFor(() => {
      expect(upsertPreferences).toHaveBeenCalledTimes(2);
    });

    serverChatCompletionEnabled = false;
    rerender(<NotificationsSection />);
    expect(screen.getAllByRole("switch")[2]).toHaveAttribute("aria-checked", "false");

    serverChatCompletionEnabled = true;
    rerender(<NotificationsSection />);
    expect(screen.getAllByRole("switch")[2]).toHaveAttribute("aria-checked", "true");
  });
});
