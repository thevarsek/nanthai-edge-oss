import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SharedDataContext,
  balanceTierOf,
  formatUsd,
  isLowBalance,
  useConnectedAccounts,
  useCreditBalance,
  useModelSummaries,
  useOpenRouterStatus,
  useSharedData,
  useShellSubscriptions,
  useVisibleSkills,
} from "./useSharedData";

const mockState = vi.hoisted(() => ({
  isSignedIn: true,
  isAuthenticated: true,
  queryResults: [] as unknown[],
  queryCalls: [] as unknown[],
  action: vi.fn(async () => ({ balance: 3.5 })),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isSignedIn: mockState.isSignedIn }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mockState.isAuthenticated }),
  useQuery: (query: unknown, args: unknown) => {
    mockState.queryCalls.push({ query, args });
    return mockState.queryResults.length <= 1 ? mockState.queryResults[0] : mockState.queryResults.shift();
  },
  useAction: () => mockState.action,
}));

describe("useSharedData subscriptions", () => {
  beforeEach(() => {
    mockState.isSignedIn = true;
    mockState.isAuthenticated = true;
    mockState.queryResults = [];
    mockState.queryCalls = [];
    mockState.action.mockReset().mockResolvedValue({ balance: 3.5 });
  });

  it("uses signed-in Convex args for shell subscriptions and skip args when unauthenticated", () => {
    mockState.queryResults = ["prefs", "models", "pro", "caps", "personas", "favorites"];
    const { result, rerender } = renderHook(() => useShellSubscriptions());

    expect(result.current).toEqual({
      prefs: "prefs",
      modelSettings: "models",
      proStatus: "pro",
      accountCapabilities: "caps",
      personas: "personas",
      favorites: "favorites",
    });
    expect(mockState.queryCalls.map((call) => (call as { args: unknown }).args)).toEqual([{}, {}, {}, {}, {}, {}]);

    mockState.isAuthenticated = false;
    mockState.queryCalls = [];
    mockState.queryResults = Array(6).fill(undefined);
    rerender();
    expect(mockState.queryCalls.map((call) => (call as { args: unknown }).args)).toEqual(["skip", "skip", "skip", "skip", "skip", "skip"]);
  });

  it("exposes shared context and throws outside the provider", () => {
    expect(() => renderHook(() => useSharedData())).toThrow("useSharedData must be used within a SharedDataProvider");

    const value = { prefs: { defaultModelId: "openai/gpt-4.1" } };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SharedDataContext.Provider value={value as never}>{children}</SharedDataContext.Provider>
    );
    const { result } = renderHook(() => useSharedData(), { wrapper });

    expect(result.current).toBe(value);
  });

  it("subscribes model, skill, OpenRouter, and connected-account data with auth-aware args", () => {
    mockState.queryResults = [
      ["model"],
      ["skill"],
      true,
      { hasDrive: true },
      { status: "active" },
      null,
      { workspace: "docs" },
      { team: "nanthai" },
      null,
      { status: "active" },
    ];

    expect(renderHook(() => useModelSummaries()).result.current).toEqual(["model"]);
    expect(renderHook(() => useVisibleSkills()).result.current).toEqual(["skill"]);
    expect(renderHook(() => useOpenRouterStatus()).result.current).toBe(true);
    expect(renderHook(() => useConnectedAccounts()).result.current).toEqual({
      googleConnection: { hasDrive: true },
      gmailManualConnection: { status: "active" },
      microsoftConnection: null,
      notionConnection: { workspace: "docs" },
      slackConnection: { team: "nanthai" },
      appleCalendarConnection: null,
      clozeConnection: { status: "active" },
    });
    expect(mockState.queryCalls.every((call) => JSON.stringify((call as { args: unknown }).args) === "{}")).toBe(true);
  });
});

describe("credit balance helpers and hook", () => {
  beforeEach(() => {
    mockState.isSignedIn = true;
    mockState.isAuthenticated = true;
    mockState.queryResults = [];
    mockState.queryCalls = [];
    mockState.action.mockReset().mockResolvedValue({ balance: 3.5 });
  });

  it("formats balance tiers and low-balance states", () => {
    expect(balanceTierOf(null)).toBe("unknown");
    expect(balanceTierOf(0.5)).toBe("red");
    expect(balanceTierOf(2)).toBe("amber");
    expect(balanceTierOf(8)).toBe("green");
    expect(isLowBalance(0.24)).toBe(true);
    expect(isLowBalance(0.25)).toBe(false);
    expect(formatUsd(1.234)).toBe("$1.23");
  });

  it("fetches credits on connection, refreshes on demand, and clears when disconnected", async () => {
    mockState.queryResults = [true];
    const { result, rerender } = renderHook(() => useCreditBalance());

    await waitFor(() => expect(result.current.balance).toBe(3.5));
    expect(mockState.action).toHaveBeenCalledWith({});

    mockState.action.mockResolvedValueOnce({ balance: 7.25 });
    await act(async () => result.current.refresh());
    expect(result.current.balance).toBe(7.25);

    mockState.queryResults = [false];
    rerender();
    expect(result.current.balance).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("ignores refresh when disconnected and keeps previous balance on fetch errors", async () => {
    mockState.queryResults = [false];
    const disconnected = renderHook(() => useCreditBalance()).result;
    await act(async () => disconnected.current.refresh());
    expect(mockState.action).not.toHaveBeenCalled();

    mockState.queryResults = [true];
    mockState.action.mockResolvedValueOnce({ balance: 2 });
    const { result } = renderHook(() => useCreditBalance());
    await waitFor(() => expect(result.current.balance).toBe(2));

    mockState.action.mockRejectedValueOnce(new Error("provider down"));
    await act(async () => result.current.refresh());
    expect(result.current.balance).toBe(2);
    expect(result.current.loading).toBe(false);
  });
});
