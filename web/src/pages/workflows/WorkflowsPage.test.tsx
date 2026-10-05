import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowsPage } from "./WorkflowsPage";
import { LocalRuntimePage } from "./LocalRuntimePage";
import { HomeWorkflowSection } from "./HomeWorkflowSection";
import i18n from "@/i18n";
import en from "@/i18n/locales/en.json";
import itLocale from "@/i18n/locales/it.json";
import fr from "@/i18n/locales/fr.json";
import es from "@/i18n/locales/es.json";
import de from "@/i18n/locales/de.json";
import ja from "@/i18n/locales/ja.json";
import zh from "@/i18n/locales/zh.json";
import savings from "./savings.json";
import evidence from "../../../../evals/runtime-context/evidence/continuity-comparison/results.json";

const downloadUrl = "https://runtime-test.convex.site/api/storage/runtime-dmg";
beforeEach(() => vi.stubEnv("VITE_NANTHAI_RUNTIME_HOST_DOWNLOAD_URL", downloadUrl));
vi.mock("@/components/edge-site/EdgeSiteLayout", () => ({ EdgeSiteLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/Seo", () => ({ Seo: () => null }));
afterEach(async () => { vi.unstubAllEnvs(); await act(() => i18n.changeLanguage("en")); });
const locales = { en, it: itLocale, fr, es, de, ja, zh };
const publicKeys = Object.keys(en).filter(key => key.startsWith("local_work_") || key.startsWith("work_") || key.startsWith("runtime_savings_") || key.startsWith("fi_group") || key.startsWith("local_capabilities_"));

describe("customer-facing workflows", () => {
  it("keeps the fixed brand tagline", () => {
    expect([en.home_hero1_line1, en.home_hero1_line2].join(' ')).toBe('The AI you need');
    expect([en.home_hero2_line1_pre, en.home_hero2_line1_accent, ' ', en.home_hero2_line2_pre, en.home_hero2_line2_accent].join('').toLowerCase()).toBe('at the price you want');
  });
  it.each(Object.entries(locales))("translates the customer journey in %s", async (language, locale) => {
    for (const key of publicKeys) expect((locale as Record<string, string>)[key], key).toBeTruthy();
    await act(() => i18n.changeLanguage(language));
    const { container } = render(<MemoryRouter><WorkflowsPage /><LocalRuntimePage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: locale.work_title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: locale.local_work_title })).toBeInTheDocument();
    expect(screen.getByText(locale.local_work_cloud)).toBeInTheDocument();
    expect(screen.getByText(locale.local_work_pi)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: locale.local_work_download })).toHaveLength(2);
    expect(screen.getByText(locale.runtime_savings_note)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/work_\w+|findings_\w+|runtime_savings_\w+/);
    expect(container.querySelector('table, details, a[download]')).toBeNull();
    if (language !== 'en') expect(container.textContent).not.toContain(en.work_title);
  });
  it("keeps internal evaluation material out of product pages and links to the canonical download owner", () => {
    const { container } = render(<MemoryRouter><HomeWorkflowSection /><WorkflowsPage /><LocalRuntimePage /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/pending verification|unreleased|in development|checking what|known bug|\bWIP\b|96 journeys|48 comparisons|4 October|How we compared|complete comparison|Accepted tasks/);
    for (const link of screen.getAllByRole('link', { name: en.local_work_download })) expect(link).toHaveAttribute('href', downloadUrl);
    expect(screen.getAllByRole('link', { name: en.work_home_link }).some(link => link.getAttribute('href') === '/workflows')).toBe(true);
    expect(container.querySelector('a[href*="research/"]')).toBeNull();
  });
  it("derives the scoped savings highlight from the audited post-repair cohort", () => {
    const row = evidence.sections.find(row => row.model === savings.model && row.harness === savings.harness && row.theme === 'Shared memory');
    expect(evidence.cohort).toBe(savings.evidenceCohort);
    expect(evidence.completedJourneys).toBe(96);
    expect(evidence.pairs).toHaveLength(48);
    expect(row?.medianChangePercent.input).toBe(-savings.inputReductionPercent);
    expect(row?.medianChangePercent.apiEquivalentUSD).toBe(-savings.estimatedCostReductionPercent);
    expect(evidence.groups.every(row => row.missingUsage === 0 && !row.childThreadsNeedAudit)).toBe(true);
  });
});
