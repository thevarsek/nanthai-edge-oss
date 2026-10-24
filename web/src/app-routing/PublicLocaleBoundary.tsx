import { useLayoutEffect, useMemo, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { I18nextProvider } from "react-i18next";
import { preferredPublicPath, readLanguagePreference } from "@/lib/publicLocale";
import { contentLanguages, type ContentLanguage } from "@/lib/contentLocale";
import appI18n, { syncDocumentLanguage } from "@/i18n";

/** URL translations are isolated from the app instance and never persist an inferred language. */
export function PublicLocaleBoundary({ language, availableLanguages = contentLanguages, children }: {
  language: ContentLanguage;
  availableLanguages?: readonly string[];
  children: ReactNode;
}) {
  const location = useLocation();
  const instance = useMemo(() => appI18n.cloneInstance({ lng: language, initAsync: false }), [language]);
  const preferred = preferredPublicPath(location.pathname, readLanguagePreference(), availableLanguages);
  useLayoutEffect(() => { syncDocumentLanguage(language); }, [language]);
  return <I18nextProvider i18n={instance}>
    {preferred ? <Navigate to={`${preferred}${location.search}${location.hash}`} replace /> : children}
  </I18nextProvider>;
}
