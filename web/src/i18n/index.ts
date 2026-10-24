import i18n from "i18next";
import type { BackendModule } from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en from "./locales/en.json";
import { parsePublicPath } from "@/lib/publicLocale";

export const SUPPORTED_LANGUAGES = [
  { code: "en", label: "English", nativeLabel: "English" },
  { code: "es", label: "Spanish", nativeLabel: "Español" },
  { code: "fr", label: "French", nativeLabel: "Français" },
  { code: "de", label: "German", nativeLabel: "Deutsch" },
  { code: "it", label: "Italian", nativeLabel: "Italiano" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語" },
  { code: "zh", label: "Chinese (Simplified)", nativeLabel: "简体中文" },
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

const localeLoaders = {
  es: () => import("./locales/es.json"),
  fr: () => import("./locales/fr.json"),
  de: () => import("./locales/de.json"),
  it: () => import("./locales/it.json"),
  ja: () => import("./locales/ja.json"),
  zh: () => import("./locales/zh.json"),
};

const lazyLocaleBackend: BackendModule = {
  type: "backend",
  init() {},
  read(language, _namespace, callback) {
    const baseLanguage = language.toLowerCase().split("-")[0];
    const loader = localeLoaders[baseLanguage as keyof typeof localeLoaders];
    if (!loader) {
      callback(new Error(`No translation bundle is available for ${language}`), false);
      return;
    }

    void loader()
      .then((module) => callback(null, module.default))
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error(String(error)), false);
      });
  },
};

export function syncDocumentLanguage(language: string | undefined) {
  if (typeof document === "undefined") return;

  const baseLanguage = language?.toLowerCase().split("-")[0];
  const supportedLanguage = baseLanguage
    && SUPPORTED_LANGUAGES.some(({ code }) => code === baseLanguage)
    ? baseLanguage
    : "en";
  document.documentElement.lang = supportedLanguage;
  const skipLink = document.getElementById("skip-to-content");
  if (skipLink) skipLink.textContent = i18n.t("content_skip", { lng: supportedLanguage });
}

export const initialization = i18n
  .use(lazyLocaleBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    lng: typeof window === "undefined" ? "en" : undefined,
    resources: {
      en: { translation: en },
    },
    partialBundledLanguages: true,
    fallbackLng: "en",
    supportedLngs: ["en", "es", "fr", "de", "it", "ja", "zh"],
    detection: {
      // Detect app language as before; only an explicit switcher choice may persist it.
      order: ["localStorage", "navigator"],
      caches: [],
      lookupLocalStorage: "nanthai_language",
    },
    interpolation: {
      // React already escapes values
      escapeValue: false,
    },
  });

function syncAppDocumentLanguage(language: string | undefined) {
  if (typeof window !== "undefined" && parsePublicPath(window.location.pathname)) return;
  syncDocumentLanguage(language);
}
i18n.on("languageChanged", syncAppDocumentLanguage);
void initialization.then(() => syncAppDocumentLanguage(i18n.resolvedLanguage ?? i18n.language));

export default i18n;
