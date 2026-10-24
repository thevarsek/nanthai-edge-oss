import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { EdgeSiteHeader } from "./EdgeSiteHeader";

let authState: { isLoaded: boolean; isSignedIn?: boolean };

vi.mock("@clerk/react", () => ({
  useAuth: () => authState,
}));

function CurrentPath() {
  return <output aria-label="Current URL">{useLocation().pathname}</output>;
}

function renderHeader(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <EdgeSiteHeader /><CurrentPath />
    </MemoryRouter>,
  );
}

describe("EdgeSiteHeader", () => {
  afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

  it("places Guides last, after Support", () => {
    authState = { isLoaded: true, isSignedIn: false };
    renderHeader();
    const links = within(screen.getByRole("navigation")).getAllByRole("link");
    expect(links.slice(-2).map(link => link.textContent)).toEqual(["Support", "Guides"]);
  });
  it("navigates the same article between localised and English URLs", async () => {
    authState = { isLoaded: true, isSignedIn: false };
    renderHeader("/guides/ai-chat-memory");
    fireEvent.click(screen.getByRole("button", { name: "Change language, current language: English" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Italiano" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("/it/guides/ai-chat-memory"));
    expect(screen.getByRole("link", { name: "Guide" })).toHaveAttribute("href", "/it/guides");
    fireEvent.click(screen.getByRole("button", { name: /Cambia lingua/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^\/guides\/ai-chat-memory$/));
  });
  it("keeps the rest of the site's URL when changing language", async () => {
    authState = { isLoaded: true, isSignedIn: false };
    renderHeader("/features/byok");
    fireEvent.click(screen.getByRole("button", { name: "Change language, current language: English" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Italiano" }));
    await waitFor(() => expect(i18n.resolvedLanguage).toBe("it"));
    expect(screen.getByRole("status")).toHaveTextContent("/features/byok");
  });
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
