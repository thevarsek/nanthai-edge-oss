import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocalRuntimeFeaturePage } from "./LocalRuntimeFeaturePage";
import { FeaturesIndexPage } from "./FeaturesIndexPage";
import { HomeCapabilitiesSection, HomeHowItWorksSection } from "../HomePage.sections";
import { HomePricingSection } from "../HomePage.pricing";
import { HomeWorkflowProofSection } from "../HomePage.proof";
import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import itLocale from "@/i18n/locales/it.json";
import fr from "@/i18n/locales/fr.json";
import es from "@/i18n/locales/es.json";
import de from "@/i18n/locales/de.json";
import ja from "@/i18n/locales/ja.json";
import zh from "@/i18n/locales/zh.json";

const downloadUrl = "https://runtime-test.convex.site/api/storage/runtime-dmg";
beforeEach(() => vi.stubEnv("VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL", downloadUrl));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ isLoaded: true, isSignedIn: false }) }));
vi.mock("@/components/edge-site/EdgeSiteLayout", () => ({ EdgeSiteLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/Seo", () => ({ Seo: () => null }));
afterEach(async () => { vi.unstubAllEnvs(); await act(() => i18n.changeLanguage("en")); });

describe("local runtime marketing", () => {
  it.each(Object.entries({ en, it: itLocale, fr, es, de, ja, zh }))("explains connection and pricing in %s", async (language, locale) => {
    await act(() => i18n.changeLanguage(language));
    const { container } = render(<MemoryRouter><HomeHowItWorksSection /><HomeCapabilitiesSection /><HomePricingSection /><HomeWorkflowProofSection /></MemoryRouter>);
    expect(screen.getByText(locale.home_hiw_step1_body)).toBeInTheDocument();
    expect(screen.getByText(locale.home_hiw_step3_body)).toBeInTheDocument();
    expect(screen.getByText(locale.home_byok_body1)).toBeInTheDocument();
    expect(screen.getByText(locale.home_byok_body2)).toBeInTheDocument();
    const pricingItem = screen.getByText(locale.home_pro_local_runtime);
    expect(within(pricingItem.closest("ul")!.parentElement!).getByText(locale.pro_2)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: locale.home_proof_heading })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/lr_seo_desc|home_pro_local_runtime|home_proof_heading/);
  });
  it("includes a normal index card and a complete matching detail page", () => {
    const { unmount } = render(<MemoryRouter><FeaturesIndexPage /></MemoryRouter>);
    const card = screen.getByRole("link", { name: new RegExp(en.local_runtime_title) });
    expect(card).toHaveAttribute("href", "/features/local-runtime");
    expect(within(card).getByText(en.pro_2)).toBeInTheDocument();
    unmount();
    render(<MemoryRouter><LocalRuntimeFeaturePage /></MemoryRouter>);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en.local_runtime_title);
    expect(screen.getByText(en.local_work_pi)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: en.local_work_download })).toHaveAttribute("href", downloadUrl);
    expect(screen.getByRole("link", { name: en.work_how })).toHaveAttribute("href", "/local-runtime");
  });
});
