import { render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomePage } from "./HomePage";
import { LicensingPage } from "./LicensingPage";
import { PrivacyPage } from "./PrivacyPage";
import { SupportPage } from "./SupportPage";
import { TermsPage } from "./TermsPage";
import { SearchPage } from "./features/SearchPage";

let authState = { isLoaded: true, isSignedIn: false };

vi.mock("@clerk/react", () => ({
  useAuth: () => authState,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.defaultValue === "string") return options.defaultValue;
      return key;
    },
    i18n: {
      language: "en",
      resolvedLanguage: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("@/components/edge-site/HeroVantaNet", () => ({
  HeroVantaNet: () => <div data-testid="hero-vanta-net" />,
}));

vi.mock("@/components/edge-site/HeroOutlineText", () => ({
  HeroOutlineText: ({ lines }: { lines: Array<Array<{ text: string }>> }) => (
    <div>{lines.flat().map((part) => part.text).join(" ")}</div>
  ),
}));

function renderPublicPage(page: React.ReactNode) {
  return render(
    <HelmetProvider>
      <MemoryRouter>{page}</MemoryRouter>
    </HelmetProvider>,
  );
}

function canonicalHref() {
  return document.querySelector('link[rel="canonical"]')?.getAttribute("href");
}

describe("public site smoke coverage", () => {
  beforeEach(() => {
    authState = { isLoaded: true, isSignedIn: false };
    document.head.innerHTML = "";
  });

  it("renders the home hero, primary CTA, pricing teaser, and signed-out header", () => {
    renderPublicPage(<HomePage />);

    expect(screen.getByRole("heading", { name: /home_hero1_line1/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /edge_start_free/i })[0]).toHaveAttribute("href", "/sign-in");
    expect(screen.getAllByRole("link", { name: /home_get_started_free/i })[0]).toHaveAttribute("href", "/sign-in");
    expect(screen.getAllByText("free").length).toBeGreaterThan(0);
    expect(screen.getAllByText("pro_2").length).toBeGreaterThan(0);
    expect(screen.getByText("home_proof_label")).toBeInTheDocument();
    expect(screen.getByText("home_proof_output_docx")).toBeInTheDocument();
    expect(screen.getByText("home_proof_output_xlsx")).toBeInTheDocument();
    expect(screen.getByText("home_proof_output_pptx")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/features/documents"),
    ).toBe(true);
    expect(
      screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/features/skills-helpers"),
    ).toBe(true);
    expect(
      screen.getAllByRole("link").some((link) => link.getAttribute("href") === "/features/analysis-code"),
    ).toBe(true);
    expect(screen.getByText("home_cap_voice_title")).toBeInTheDocument();
    expect(screen.getByText("home_byok_title")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edge_footer_web_app/i })).toHaveAttribute(
      "href",
      "https://nanthai.tech/app",
    );
    expect(canonicalHref()).toBe("https://nanthai.tech");
  });

  it("renders an auth-aware home header for signed-in users", () => {
    authState = { isLoaded: true, isSignedIn: true };

    renderPublicPage(<HomePage />);

    expect(screen.getByRole("link", { name: /edge_go_to_app/i })).toHaveAttribute("href", "/app");
  });

  it.each([
    { page: <PrivacyPage />, title: "priv_label | NanthAI Edge", heading: "priv_hero_title", canonical: "https://nanthai.tech/privacy" },
    { page: <TermsPage />, title: "tos_label | NanthAI Edge", heading: "tos_hero_title", canonical: "https://nanthai.tech/terms" },
    { page: <LicensingPage />, title: "lic_label | NanthAI Edge", heading: "lic_hero_title", canonical: "https://nanthai.tech/licensing" },
    { page: <SupportPage />, title: "sp_label | NanthAI Edge", heading: "sp_hero_title", canonical: "https://nanthai.tech/support" },
  ])("renders legal page headings and metadata for $title", async ({ page, title, heading, canonical }) => {
    renderPublicPage(page);

    expect(await screen.findByRole("heading", { name: new RegExp(heading, "i") })).toBeInTheDocument();
    expect(document.title).toBe(title);
    expect(canonicalHref()).toBe(canonical);
  });

  it("renders a representative feature page with site chrome and CTA destinations", () => {
    renderPublicPage(<SearchPage />);

    expect(screen.getByRole("heading", { name: /Search & Research/i })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /edge_nav_features/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /GitHub/i })).toHaveAttribute("href", "https://github.com/thevarsek/nanthai-edge-oss");
    expect(screen.getByRole("link", { name: /edge_start_free_upgrade_later/i })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: /edge_see_all_features/i })).toHaveAttribute("href", "/features");
    expect(document.title).toBe("Search & Research — NanthAI Edge");
    expect(canonicalHref()).toBe("https://nanthai.tech/features/search");
  });
});
