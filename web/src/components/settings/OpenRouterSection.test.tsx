import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenRouterSection } from "./OpenRouterSection";
import { OPENROUTER_PREFERENCE_STALE_ECHO_GUARD_MS } from "./useOptimisticOpenRouterPreference";

let prefs: { showBalanceInChat?: boolean; showAdvancedStats?: boolean } = {};
const upsertPreferences = vi.fn();
const deleteApiKey = vi.fn();
const refreshCredits = vi.fn();
const { captureSettingChanged } = vi.hoisted(() => ({
  captureSettingChanged: vi.fn(),
}));

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

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

vi.mock("@/lib/featureAnalytics", () => ({
  captureSettingChanged,
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
    captureSettingChanged.mockReset();
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
    await waitFor(() => {
      expect(captureSettingChanged).toHaveBeenCalledWith({
        setting_key: "showBalanceInChat",
        setting_area: "settings",
        value_type: "boolean",
      });
    });

    await act(async () => {
      prefs = { showBalanceInChat: false, showAdvancedStats: false };
      rerender(<OpenRouterSection />);
      await Promise.resolve();
    });

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");

    prefs = { showBalanceInChat: true, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    await waitFor(() => {
      expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
    });
  });

  it("does not rewrite later server changes after the optimistic value catches up", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<OpenRouterSection />);
    const [balanceSwitch] = screen.getAllByRole("switch");

    await act(async () => {
      fireEvent.click(balanceSwitch);
      await Promise.resolve();
    });
    expect(upsertPreferences).toHaveBeenCalledWith({ showBalanceInChat: true });

    await act(async () => {
      prefs = { showBalanceInChat: true, showAdvancedStats: false };
      rerender(<OpenRouterSection />);
      await Promise.resolve();
    });
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");

    await act(async () => {
      vi.advanceTimersByTime(OPENROUTER_PREFERENCE_STALE_ECHO_GUARD_MS + 1);
      await Promise.resolve();
    });

    await act(async () => {
      prefs = { showBalanceInChat: false, showAdvancedStats: false };
      rerender(<OpenRouterSection />);
      await Promise.resolve();
    });
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
    expect(upsertPreferences).toHaveBeenCalledTimes(1);
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
    expect(captureSettingChanged).not.toHaveBeenCalled();
  });

  it("rewrites a stale server echo after the matching preference value was rendered", async () => {
    vi.useFakeTimers();
    const correctiveRequest = deferred();
    upsertPreferences
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => correctiveRequest.promise);
    const { rerender } = render(<OpenRouterSection />);
    const [balanceSwitch] = screen.getAllByRole("switch");

    await act(async () => {
      fireEvent.click(balanceSwitch);
      await Promise.resolve();
    });
    prefs = { showBalanceInChat: true, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");

    prefs = { showBalanceInChat: false, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");
    expect(upsertPreferences).toHaveBeenNthCalledWith(2, { showBalanceInChat: true });

    await act(async () => {
      correctiveRequest.resolve();
      await correctiveRequest.promise;
    });

    expect(captureSettingChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps a rapid no-op optimistic toggle through stale preference echoes", async () => {
    const firstRequest = deferred();
    const secondRequest = deferred();
    upsertPreferences
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    const { rerender } = render(<OpenRouterSection />);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");

    prefs = { showBalanceInChat: true, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
    expect(upsertPreferences).toHaveBeenNthCalledWith(1, { showBalanceInChat: true });
    expect(upsertPreferences).toHaveBeenNthCalledWith(2, { showBalanceInChat: false });

    await act(async () => {
      firstRequest.resolve();
      await firstRequest.promise;
    });

    prefs = { showBalanceInChat: false, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
  });

  it("ignores an older failed preference request after a newer success", async () => {
    const firstRequest = deferred();
    const secondRequest = deferred();
    upsertPreferences
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise);
    const { rerender } = render(<OpenRouterSection />);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(upsertPreferences).toHaveBeenNthCalledWith(1, { showBalanceInChat: true });
    expect(upsertPreferences).toHaveBeenNthCalledWith(2, { showBalanceInChat: false });

    await act(async () => {
      secondRequest.resolve();
      await secondRequest.promise;
    });
    prefs = { showBalanceInChat: false, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    await act(async () => {
      firstRequest.reject(new Error("first request failed"));
      await firstRequest.promise.catch(() => undefined);
    });

    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("first request failed")).not.toBeInTheDocument();
  });

  it("rewrites the latest preference after an older successful request resolves late", async () => {
    const firstRequest = deferred();
    const secondRequest = deferred();
    const correctiveRequest = deferred();
    upsertPreferences
      .mockImplementationOnce(() => firstRequest.promise)
      .mockImplementationOnce(() => secondRequest.promise)
      .mockImplementationOnce(() => correctiveRequest.promise);
    const { rerender } = render(<OpenRouterSection />);

    fireEvent.click(screen.getAllByRole("switch")[0]);
    fireEvent.click(screen.getAllByRole("switch")[0]);

    expect(upsertPreferences).toHaveBeenNthCalledWith(1, { showBalanceInChat: true });
    expect(upsertPreferences).toHaveBeenNthCalledWith(2, { showBalanceInChat: false });

    await act(async () => {
      secondRequest.resolve();
      await secondRequest.promise;
    });
    prefs = { showBalanceInChat: false, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    await act(async () => {
      firstRequest.resolve();
      await firstRequest.promise;
    });
    prefs = { showBalanceInChat: true, showAdvancedStats: false };
    rerender(<OpenRouterSection />);

    expect(upsertPreferences).toHaveBeenNthCalledWith(3, { showBalanceInChat: false });
    expect(screen.getAllByRole("switch")[0]).toHaveAttribute("aria-checked", "false");

    await act(async () => {
      correctiveRequest.resolve();
      await correctiveRequest.promise;
    });

    expect(captureSettingChanged).toHaveBeenCalledTimes(2);
  });
});
