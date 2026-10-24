import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { I18nextProvider, useTranslation } from "react-i18next";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "@/i18n";
import { parsePublicPath } from "@/lib/publicLocale";
import { PublicLocaleBoundary } from "./PublicLocaleBoundary";

function Probe() {
  const { i18n: pageI18n } = useTranslation();
  const { pathname } = useLocation();
  return <output>{pathname} {pageI18n.resolvedLanguage}</output>;
}
function Page() {
  const { pathname } = useLocation();
  return <PublicLocaleBoundary language={parsePublicPath(pathname)?.language ?? "en"}><Probe /></PublicLocaleBoundary>;
}
afterEach(async () => { cleanup(); localStorage.clear(); await i18n.changeLanguage("en"); });
it("renders a locale URL without changing the app instance or its explicit preference", async () => {
  await i18n.loadLanguages(["de", "it"]);
  await i18n.changeLanguage("it");
  localStorage.setItem("nanthai_language", "it");
  render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={["/de/guides/ai-chat-memory"]}><Page /></MemoryRouter></I18nextProvider>);
  expect(screen.getByRole("status")).toHaveTextContent("/de/guides/ai-chat-memory de");
  expect(document.documentElement.lang).toBe("de");
  expect(i18n.resolvedLanguage).toBe("it");
  expect(localStorage.getItem("nanthai_language")).toBe("it");
});
it("replaces unprefixed URLs for an explicit preference without persisting inferred language", async () => {
  await i18n.loadLanguages("it");
  localStorage.setItem("nanthai_language", "it");
  render(<I18nextProvider i18n={i18n}><MemoryRouter initialEntries={["/guides"]}><Page /></MemoryRouter></I18nextProvider>);
  expect(await screen.findByRole("status")).toHaveTextContent("/it/guides it");
  cleanup();
  localStorage.clear();
  await act(() => i18n.changeLanguage("ja"));
  expect(localStorage.getItem("nanthai_language")).toBeNull();
});
