import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { RootLayout } from "./RootLayout";

vi.mock("@/components/layout/Sidebar", () => ({
  Sidebar: () => <div>sidebar</div>,
}));

vi.mock("@/components/shared/InstallBanner", () => ({
  InstallBanner: () => null,
}));

vi.mock("@/components/shared/OfflineBanner", () => ({
  OfflineBanner: () => null,
}));

vi.mock("@/components/shared/MainWalkthrough", () => ({
  MainWalkthrough: () => null,
}));

vi.mock("@/hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: () => {},
}));

vi.mock("@/components/shared/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function renderRootLayout() {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <RootLayout />
    </MemoryRouter>,
  );
}

describe("RootLayout", () => {
  afterEach(() => {
    localStorage.clear();
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("falls back to the default sidebar width when localStorage is corrupt", () => {
    localStorage.setItem("nanth-sidebar-width", "bad");

    renderRootLayout();

    expect(screen.getByRole("separator", { name: /resize sidebar/i })).toHaveAttribute("aria-valuenow", "280");
  });

  it("restores global body resize styles when unmounted mid-drag", () => {
    const { unmount } = renderRootLayout();

    fireEvent.mouseDown(screen.getByRole("separator", { name: /resize sidebar/i }), { clientX: 280 });
    expect(document.body.style.cursor).toBe("col-resize");
    expect(document.body.style.userSelect).toBe("none");

    unmount();

    expect(document.body.style.cursor).toBe("");
    expect(document.body.style.userSelect).toBe("");
  });
});
