import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { HomeFinalCTA, HomePricingSection } from "./HomePage.pricing";

let authState = { isLoaded: true, isSignedIn: false };

vi.mock("@clerk/react", () => ({
  useAuth: () => authState,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("HomeFinalCTA", () => {
  it("routes signed-out users to sign-in", () => {
    authState = { isLoaded: true, isSignedIn: false };

    render(<HomeFinalCTA />, { wrapper: MemoryRouter });

    expect(screen.getByRole("link", { name: /home_get_started_free/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("routes signed-in users to the app", () => {
    authState = { isLoaded: true, isSignedIn: true };

    render(<HomeFinalCTA />, { wrapper: MemoryRouter });

    expect(screen.getByRole("link", { name: /home_go_to_app/i })).toHaveAttribute("href", "/app");
  });

  it("disables and prevents CTA navigation while auth state is loading", () => {
    authState = { isLoaded: false, isSignedIn: false };
    render(<HomeFinalCTA />, { wrapper: MemoryRouter });
    const link = screen.getByRole("link", { name: /home_get_started_free/i });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });

    link.dispatchEvent(event);

    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveClass("pointer-events-none");
    expect(event.defaultPrevented).toBe(true);
  });

  it("smoke-renders the pricing section tiers and BYOK explainer", () => {
    render(<HomePricingSection />, { wrapper: MemoryRouter });

    expect(screen.getByText("free")).toBeInTheDocument();
    expect(screen.getByText("pro_2")).toBeInTheDocument();
    expect(screen.getByText("home_byok_title")).toBeInTheDocument();
  });
});
