import { Children, isValidElement, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "react-router-dom";
import { headingId } from "./articleData";
import { ResearchDiagram } from "./ResearchDiagram";

function textContent(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textContent(child.props.children) : "";
  }).join("");
}

export function ArticleMarkdown({ body }: { body: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} components={{
    p: ({ children }) => Children.toArray(children).some(child => isValidElement<{ src?: string }>(child) && child.props.src?.startsWith("diagram:"))
      ? <div>{children}</div> : <p>{children}</p>,
    h2: ({ children }) => <h2 id={headingId(textContent(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={headingId(textContent(children))}>{children}</h3>,
    a: ({ href, children }) => href?.startsWith("/")
      ? <Link to={href}>{children}</Link> : <a href={href}>{children}</a>,
    img: ({ src, alt }) => src?.startsWith("diagram:")
      ? <ResearchDiagram id={src.slice(8)} />
      : <img src={src} alt={alt ?? ""} loading="lazy" />,
  }} urlTransform={url => url.startsWith("diagram:") ? url : /^(https?:|mailto:|\/|#)/i.test(url) ? url : ""}>{body}</Markdown>;
}
