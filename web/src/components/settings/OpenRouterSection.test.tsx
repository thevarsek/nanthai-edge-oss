import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterSection } from "./OpenRouterSection";

let prefs: { showBalanceInChat?: boolean; showAdvancedStats?: boolean } = {};
const upsertPreferences = vi.fn();
const deleteApiKey = vi.fn();
const refreshCredits = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSharedData", () => ({
  balanceTierOf: (balance: number | null) => balance === null ? "unknown" : "green",
  formatUsd: (balance: number) => `$${balance.toFixed(2)}`,
  useCreditBalance: () => ({ balance: 5, loading: false, refresh: refreshCredits }),
  useOpenRouterStatus: () => true,
  useSharedData: () => ({ prefs }),
}));

vi.mock("@convex/_generated/api", () => ({
  api: {
    preferences: { mutations: { upsertPreferences: "upsertPreferences" } },
    scheduledJobs: { mutations: { deleteApiKey: "deleteApiKey" } },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: (mutation: string) => {
    if (mutation === "upsertPreferences") return upsertPreferences;
    return deleteApiKey;
  },
}));

describe("OpenRouterSection", () => {
  beforeEach(() => {
    prefs = { showBalanceInChat: false, showAdvancedStats: false };
    upsertPreferences.mockReset();
    deleteApiKey.mockReset();
    refreshCredits.mockReset();
    upsertPreferences.mockResolvedValue(undefined);
    deleteApiKey.mockResolvedValue(undefined);
    refreshCredits.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an optimistic toggle through stale preference echoes until the matching value arrives", async () => {
    const { rerender } = render(<OpenRouterSection />);
    const [balanceSwitch] = screen.getAllByRole("switch");

    fireEvent.click(balanceSwitch);

    expect(balanceSwitch).toHaveAttribute("aria-checked", "true");
    expect(upsertPreferences).toHaveBeenCalledWith({ showBalanceInChat: true });

    prefs = { showBalanceInChat: false, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");

    prefs = { showBalanceInChat: true, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    await waitFor(() => {
      expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
    });
  });

  it("rolls back an optimistic preference toggle and shows the save error when Convex rejects it", async () => {
    upsertPreferences.mockRejectedValueOnce(new Error("network down"));
    render(<OpenRouterSection />);
    const [, advancedStatsSwitch] = screen.getAllByRole("switch");

    fireEvent.click(advancedStatsSwitch);

    expect(advancedStatsSwitch).toHaveAttribute("aria-checked", "true");
    expect(upsertPreferences).toHaveBeenCalledWith({ showAdvancedStats: true });

    expect(await screen.findByText("network down")).toBeInTheDocument();
    expect(screen.getAllByRole("switch")[1]).toHaveAttribute("aria-checked", "false");
  });

  it("clears a completed optimistic preference only after the matching server echo is rendered", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<OpenRouterSection />);
    const [balanceSwitch] = screen.getAllByRole("switch");

    fireEvent.click(balanceSwitch);
    prefs = { showBalanceInChat: true, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    prefs = { showBalanceInChat: false, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
  });
});
