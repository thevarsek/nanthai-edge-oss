import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainWalkthrough } from "./MainWalkthrough";
import { nextWalkthroughSelection } from "./MainWalkthrough.utils";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));

vi.mock("@convex/_generated/api", () => ({
  api: { preferences: { mutations: { upsertPreferences: "upsertPreferences" } } },
}));

vi.mock("@/hooks/useSharedData", () => ({
  useSharedData: () => ({ prefs: { hasSeenMainWalkthrough: false } }),
}));

describe("MainWalkthrough", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps rapid next clicks within the available card range", () => {
    const total = 6;

    const firstQueuedUpdate = nextWalkthroughSelection(4, total);
    const secondQueuedUpdate = nextWalkthroughSelection(firstQueuedUpdate, total);

    expect(firstQueuedUpdate).toBe(5);
    expect(secondQueuedUpdate).toBe(5);
  });

  it("renders as a focus-contained dialog", () => {
    vi.useFakeTimers();

    render(<MainWalkthrough />);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    const dialog = screen.getByRole("dialog", { name: "Getting Started" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    const close = screen.getByRole("button", { name: "Dismiss" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();
  });
});
