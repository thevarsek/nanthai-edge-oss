import { render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PrivacyPage } from "./PrivacyPage";

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

describe("PrivacyPage", () => {
  it("renders required legal content and canonical metadata", async () => {
    render(
      <HelmetProvider>
        <MemoryRouter>
          <PrivacyPage />
        </MemoryRouter>
      </HelmetProvider>,
    );

    expect(screen.getByRole("heading", { name: /plain-language view/i })).toBeInTheDocument();
    expect(screen.getByText(/July 31, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/PostHog Cloud EU/i)).toBeInTheDocument();
    expect(screen.getByText(/not shown inside the web app or installed PWA/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "support@nanthai.tech" })).toHaveAttribute(
      "href",
      "mailto:support@nanthai.tech",
    );
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://nanthai.tech/privacy",
    );
  });
});
