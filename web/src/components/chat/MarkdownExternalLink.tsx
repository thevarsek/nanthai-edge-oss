import { Children, isValidElement, useState } from "react";
import type { MouseEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { shouldConfirmLink } from "@/lib/markdownLinkSpoofing";

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return Children.toArray(node).map(nodeText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return "";
}

function hostOf(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

interface MarkdownExternalLinkProps {
  href: string | undefined;
  className?: string;
  children?: ReactNode;
}

/**
 * Renders a markdown link. When the visible text names a different site than
 * the one the link opens, the real destination is shown for confirmation first.
 */
export function MarkdownExternalLink({ href, className, children }: MarkdownExternalLinkProps) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const needsConfirmation = href !== undefined && shouldConfirmLink(nodeText(children), href);

  function interceptOpen(event: MouseEvent<HTMLAnchorElement>) {
    if (!needsConfirmation) return;
    event.preventDefault();
    setConfirming(true);
  }

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onClick={interceptOpen}
        onAuxClick={interceptOpen}
      >
        {children}
      </a>
      {href !== undefined && createPortal(
        <ConfirmDialog
          isOpen={confirming}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            window.open(href, "_blank", "noopener,noreferrer");
          }}
          title={t("markdown_link_confirm_title")}
          description={t("markdown_link_confirm_description", { host: hostOf(href), url: href })}
          confirmLabel={t("markdown_link_confirm_open")}
          confirmVariant="default"
        />,
        document.body,
      )}
    </>
  );
}
