import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { EdgeSiteHeader } from "./EdgeSiteHeader";

let authState: { isLoaded: boolean; isSignedIn?: boolean };

vi.mock("@clerk/react", () => ({
  useAuth: () => authState,
}));

function renderHeader() {
  return render(
    <MemoryRouter>
      <EdgeSiteHeader />
    </MemoryRouter>,
  );
}

describe("EdgeSiteHeader", () => {
  it("does not expose sign-in navigation before Clerk auth has loaded", () => {
    authState = { isLoaded: false, isSignedIn: undefined };

    renderHeader();

    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toHaveAttribute("aria-busy", "true");
  });

  it("closes the mobile menu when navigating via the logo", () => {
    authState = { isLoaded: true, isSignedIn: false };

    renderHeader();
    fireEvent.click(screen.getByRole("button", { name: /navigation/i }));
    expect(screen.getAllByRole("link", { name: /features/i })).toHaveLength(2);

    fireEvent.click(screen.getByRole("link", { name: /home/i }));

    expect(screen.getAllByRole("link", { name: /features/i })).toHaveLength(1);
  });
});
