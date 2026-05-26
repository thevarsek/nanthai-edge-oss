import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "./Toast";
import { useToast } from "./Toast.context";

function TriggerToast() {
  const { toast } = useToast();
  useEffect(() => {
    toast({ message: "Saved" });
  }, [toast]);
  return null;
}

describe("ToastProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cleans exit animation timers on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(
      <ToastProvider>
        <TriggerToast />
      </ToastProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Saved");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(screen.getByRole("alert")).toHaveClass("opacity-0");

    unmount();
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps toast container within narrow mobile viewport gutters", () => {
    render(
      <ToastProvider>
        <TriggerToast />
      </ToastProvider>,
    );

    expect(screen.getByRole("alert").parentElement).toHaveClass("left-4", "right-4", "w-auto");
    expect(screen.getByText("Saved")).toHaveClass("break-words");
  });
});
