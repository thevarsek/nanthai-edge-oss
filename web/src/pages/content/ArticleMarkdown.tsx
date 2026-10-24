import { Children, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PublicLink as Link } from "@/components/edge-site/PublicLink";
import { useTranslation } from "react-i18next";
import { localizeContentPath, type ContentLanguage } from "@/lib/contentLocale";
import { headingId } from "./articleData";
import { ResearchDiagram } from "./ResearchDiagram";

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : "";
  }).join("");
}

export function ArticleMarkdown({ body, language = "en" }: { body: string; language?: ContentLanguage }) {
  const { i18n } = useTranslation();
  const t = i18n.getFixedT(language);
  return <Markdown remarkPlugins={[remarkGfm]} components={{
    p: ({ children }) => Children.toArray(children).some(child => isValidElement<{ href?: string }>(child) && child.props.href?.startsWith("https://www.linkedin.com/pulse/"))
      ? <p>{t("content_also_published")} {Children.toArray(children).filter(child => isValidElement(child))}.</p>
      : Children.toArray(children).some(child => isValidElement<{ src?: string }>(child) && child.props.src?.startsWith("diagram:"))
      ? <div>{children}</div> : <p>{children}</p>,
    h2: ({ children }) => <h2 id={headingId(textContent(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={headingId(textContent(children))}>{children}</h3>,
    a: ({ href, children }) => href?.startsWith("/")
      ? <Link to={localizeContentPath(href, language)}>{children}</Link> : <a href={href}>{children}</a>,
    img: ({ src, alt }) => src?.startsWith("diagram:")
      ? <ResearchDiagram id={src.slice(8)} />
      : <img src={src} alt={alt ?? ""} loading="lazy" />,
  }} urlTransform={url => url.startsWith("diagram:") ? url : /^(https?:|mailto:|\/|#)/i.test(url) ? url : ""}>{body}</Markdown>;
}
