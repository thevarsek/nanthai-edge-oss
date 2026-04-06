// components/chat/MarkdownRenderer.tsx
// Full-featured markdown renderer with syntax highlighting, LaTeX, tables,
// code copy, and a parse cache for streaming performance.

import { memo, useCallback, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";
import type { Element } from "hast";

// ─── Static plugin arrays (stable references — never recreated) ──────────────
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath];
const REHYPE_PLUGINS: PluggableList = [rehypeHighlight, rehypeKatex, rehypeRaw];

// ─── Copy helper ──────────────────────────────────────────────────────────────

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for non-secure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// ─── Code block with copy button ─────────────────────────────────────────────

function CodeBlock({
  children,
  className,
  inline,
}: {
  children: string;
  className?: string;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const copied = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleCopy = useCallback(async () => {
    if (copied.current) return;
    await copyText(children);
    copied.current = true;
    if (btnRef.current) {
      btnRef.current.textContent = t("copied_code");
      btnRef.current.classList.add("text-green-400");
    }
    setTimeout(() => {
      copied.current = false;
      if (btnRef.current) {
        btnRef.current.textContent = t("copy_code");
        btnRef.current.classList.remove("text-green-400");
      }
    }, 2000);
  }, [children, t]);

  if (inline) {
    return (
      <code className="px-1.5 py-0.5 rounded text-[0.85em] font-mono bg-nanth-code text-foreground">
        {children}
      </code>
    );
  }

  // Extract language from className (e.g. "language-typescript")
  const lang = className?.replace("language-", "") ?? "";

  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-border/20 bg-nanth-code group">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-surface-3/50">
        <span className="text-xs font-mono text-muted uppercase tracking-wider">
          {lang || "code"}
        </span>
        <button
          ref={btnRef}
          onClick={handleCopy}
          className="text-xs text-muted hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-surface-3"
          aria-label="Copy code"
        >
          {t("copy_code")}
        </button>
      </div>
      {/* Code content — syntax highlighting applied by rehype-highlight */}
      <pre className="overflow-x-auto p-4 text-sm leading-relaxed m-0">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

// (MarkdownTable moved below)

// ─── Table wrapper ─────────────────────────────────────────────────────────────

function MarkdownTable({
  children,
  content,
}: {
  children: React.ReactNode;
  content: string;
}) {
  const { t } = useTranslation();
  const handleCopy = useCallback(() => copyText(content), [content]);

  return (
    <div className="relative my-3 group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 text-xs text-muted hover:text-foreground transition-colors px-2 py-0.5 rounded bg-nanth-code border border-border/20 opacity-0 group-hover:opacity-100"
        aria-label="Copy table"
      >
        {t("copy_table")}
      </button>
      <div className="overflow-x-auto rounded-xl border border-border/20">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    </div>
  );
}

// ─── Components map ───────────────────────────────────────────────────────────
// Built from content so copy-table always reflects the rendered markdown.

function buildComponents(content: string): Components {
  return {
    // Code — inline vs block differentiated by the `inline` prop
    code({ className, children, node }) {
      const hNode = node as Element | undefined;
      const isInline =
        hNode?.tagName === "code" &&
        hNode?.properties?.["data-inline"] === true;

      return (
        <CodeBlock
          className={className}
          inline={isInline}
        >
          {String(children ?? "").replace(/\n$/, "")}
        </CodeBlock>
      );
    },

    // Wrap pre so we don't double-render it
    pre({ children }) {
      return <>{children}</>;
    },

    // Table with copy
    table({ children }) {
      return (
        <MarkdownTable content={content}>{children}</MarkdownTable>
      );
    },

    // Table cells
    thead({ children }) {
      return (
        <thead className="bg-surface-3/50 text-muted text-xs uppercase tracking-wider">
          {children}
        </thead>
      );
    },
    tbody({ children }) {
      return <tbody className="divide-y divide-border/30">{children}</tbody>;
    },
    tr({ children }) {
      return <tr className="hover:bg-surface-3/50 transition-colors">{children}</tr>;
    },
    th({ children }) {
      return (
        <th className="px-4 py-2 text-left font-semibold border-b border-border/20">
          {children}
        </th>
      );
    },
    td({ children }) {
      return <td className="px-4 py-2">{children}</td>;
    },

    // Headings
    h1({ children }) {
      return <h1 className="text-2xl font-bold mt-6 mb-3 text-foreground">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="text-xl font-semibold mt-5 mb-2 text-foreground">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground">{children}</h3>;
    },
    h4({ children }) {
      return <h4 className="text-base font-semibold mt-3 mb-1 text-foreground">{children}</h4>;
    },

    // Paragraph
    p({ children }) {
      return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
    },

    // Lists
    ul({ children }) {
      return <ul className="mb-3 pl-5 space-y-1 list-disc">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="mb-3 pl-5 space-y-1 list-decimal">{children}</ol>;
    },
    li({ children }) {
      return <li className="leading-relaxed">{children}</li>;
    },

    // Blockquote
    blockquote({ children }) {
      return (
        <blockquote className="border-l-4 border-primary pl-4 my-3 italic text-muted">
          {children}
        </blockquote>
      );
    },

    // Horizontal rule
    hr() {
      return <hr className="my-4 border-border/20" />;
    },

    // Links — open in new tab, never navigate away
    a({ href, children }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
        >
          {children}
        </a>
      );
    },

    // Strong / em
    strong({ children }) {
      return <strong className="font-semibold text-foreground">{children}</strong>;
    },
    em({ children }) {
      return <em className="italic">{children}</em>;
    },
  };
}

// ─── Public component ─────────────────────────────────────────────────────────

interface MarkdownRendererProps {
  content: string;
  /** When true, uses `will-change: contents` hint for streaming render. */
  streaming?: boolean;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  streaming = false,
  className = "",
}: MarkdownRendererProps) {
  const components = useMemo(() => buildComponents(content), [content]);

  return (
    <div
      className={[
        "markdown-body text-sm text-foreground leading-relaxed",
        streaming && "will-change-contents",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
