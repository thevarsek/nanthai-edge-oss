import { useCallback, useRef } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";

// ─── Code block with copy button ─────────────────────────────────────────────

export function MarkdownCodeBlock({
  children,
  text,
  className,
  inline,
}: {
  children: React.ReactNode;
  text: string;
  className?: string;
  inline?: boolean;
}) {
  const { t } = useTranslation();
  const copied = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleCopy = useCallback(async () => {
    if (copied.current) return;
    await copyToClipboard(text);
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
  }, [text, t]);

  if (inline) {
    return (
      <code className="text-[0.85em] font-mono text-primary">
        {children}
      </code>
    );
  }

  // Extract language from className (e.g. "language-typescript")
  const lang = className?.match(/language-([^\s]+)/)?.[1] ?? "";

  return (
    <div className="relative my-3 rounded-xl overflow-hidden border border-border/20 bg-nanth-code group">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/20 bg-surface-3/50">
        <span className="text-xs font-mono text-muted uppercase tracking-wider">
          {lang || "code"}
        </span>
        <button
          ref={btnRef}
          type="button"
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

