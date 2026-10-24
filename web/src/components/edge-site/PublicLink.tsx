import { Link, type LinkProps } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { contentLanguage } from "@/lib/contentLocale";
import { publicPath } from "@/lib/publicLocale";

/** Public navigation retains the locale; application URLs and external destinations stay intact. */
export function PublicLink({ to, ...props }: LinkProps) {
  const { i18n } = useTranslation();
  const language = contentLanguage(i18n.resolvedLanguage ?? i18n.language);
  let localized = to;
  if (typeof to === "string") {
    const boundary = to.search(/[?#]/);
    const pathname = boundary < 0 ? to : to.slice(0, boundary);
    const suffix = boundary < 0 ? "" : to.slice(boundary);
    localized = `${publicPath(pathname, language)}${suffix}`;
  } else if (to.pathname) localized = { ...to, pathname: publicPath(to.pathname, language) };
  return <Link {...props} to={localized} />;
}
