import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

const analytics = vi.hoisted(() => ({
  captureAnalyticsException: vi.fn(),
}));

vi.mock("@/lib/analytics", () => analytics);

function ThrowingChild(): ReactElement {
  throw new Error("secret internal token detail");
}

describe("ErrorBoundary", () => {
  it("shows a generic fallback without exposing raw exception text", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    analytics.captureAnalyticsException.mockReset();

    render(
      <ErrorBoundary level="test">
        <ThrowingChild />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("An unexpected error occurred. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText(/secret internal token detail/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret internal token detail");
    expect(analytics.captureAnalyticsException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Error" }),
      expect.objectContaining({
        boundary_level: "test",
        has_component_stack: true,
      }),
    );
    expect(JSON.stringify(analytics.captureAnalyticsException.mock.calls)).not.toContain(
      "secret internal token detail",
    );

    consoleError.mockRestore();
  });
});
