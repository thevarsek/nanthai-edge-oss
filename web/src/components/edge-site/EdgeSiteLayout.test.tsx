import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { EdgeSiteLayout } from "./EdgeSiteLayout";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

describe("EdgeSiteLayout", () => {
  it("renders the site shell with header, footer, children, and custom main classes", () => {
    const { container } = render(
      <MemoryRouter>
        <EdgeSiteLayout activePage="features" mainClassName="custom-main">
          <h1>Feature page body</h1>
        </EdgeSiteLayout>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Feature page body" })).toBeInTheDocument();
    expect(container.querySelector("main")).toHaveClass("custom-main");
    expect(screen.getAllByRole("link", { name: /features/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
  });
});
