// components/chat/ReasoningBlock.tsx
// Collapsible "thinking" block for reasoning-capable models.

import { useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "./MarkdownRenderer";

// ---------------------------------------------------------------------------
// normalizeReasoning – port of iOS ReasoningTextFormatter.normalize()
// Fixes bold headings (**Title**) concatenated onto adjacent text, which is
// common in reasoning model output (o1, DeepSeek-R1, etc.).
// ---------------------------------------------------------------------------
function normalizeReasoning(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!s) return "";

  // Insert \n\n BEFORE a bold heading glued to preceding non-whitespace
  s = s.replace(/(?<=\S)(\*\*[A-Z][^*\n]{2,80}\*\*)/g, "\n\n$1");

  // Insert \n\n AFTER a bold heading glued to following letter
  s = s.replace(/(\*\*[A-Z][^*\n]{2,80}\*\*)(?=[A-Za-z])/g, "$1\n\n");

  // Collapse 3+ consecutive newlines to exactly 2
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

interface Props {
  reasoning: string;
  isStreaming?: boolean;
}

export function ReasoningBlock({ reasoning, isStreaming }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const normalized = useMemo(() => normalizeReasoning(reasoning), [reasoning]);
  const panelId = useId();

  if (!normalized) return null;

  return (
    <div className="mb-2 rounded-xl border border-primary/20 bg-primary/5 overflow-hidden text-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-primary/10 transition-colors"
      >
        <Brain size={14} className="text-primary shrink-0" aria-hidden="true" />
        <span className="text-primary font-medium flex-1 text-xs uppercase tracking-wider">
          {isStreaming ? t("thinking") : t("reasoning")}
        </span>
        {expanded ? (
          <ChevronDown size={14} className="text-primary shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight size={14} className="text-primary shrink-0" aria-hidden="true" />
        )}
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-primary/20 px-4 py-3">
          <MarkdownRenderer
            content={normalized}
            streaming={isStreaming}
            className="text-xs opacity-80"
          />
        </div>
      )}
    </div>
  );
}
