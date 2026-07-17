import { Presentation } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PresentationContext } from "@/hooks/useChat";

function presentationMessageTargetLabel(
  context: PresentationContext,
  baseLabel: string,
): string {
  const parts = [baseLabel];
  const slideNumber = context.slideId?.match(/^slide[-_ ]?(\d+)$/i)?.[1];
  if (slideNumber) parts.push(`#${slideNumber}`);
  if (context.elementId) {
    const readableElement = context.elementId
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/^./, (character) => character.toUpperCase());
    if (readableElement) parts.push(readableElement);
  }
  return parts.join(" · ");
}

export function PresentationMessageTarget({ context }: { context: PresentationContext }) {
  const { t } = useTranslation();
  const label = presentationMessageTargetLabel(context, t("presentation_target"));

  return (
    <div
      className="flex max-w-[75%] items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[11px] text-muted"
      data-testid="presentation-message-target"
    >
      <Presentation size={12} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </div>
  );
}
