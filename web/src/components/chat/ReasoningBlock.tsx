// components/chat/ReasoningBlock.tsx
// Collapsible "thinking" block for reasoning-capable models.

import { useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface Props {
  reasoning: string;
  isStreaming?: boolean;
}

export function ReasoningBlock({ reasoning, isStreaming }: Props) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  if (!reasoning) return null;

  return (
    <div className="mb-2 rounded-xl border border-primary/20 bg-primary/5 overflow-hidden text-sm">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-primary/10 transition-colors"
      >
        <Brain size={14} className="text-primary shrink-0" />
        <span className="text-primary font-medium flex-1 text-xs uppercase tracking-wider">
          {isStreaming ? t("thinking") : t("reasoning")}
        </span>
        {expanded ? (
          <ChevronDown size={14} className="text-primary shrink-0" />
        ) : (
          <ChevronRight size={14} className="text-primary shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-primary/20 px-4 py-3">
          <MarkdownRenderer
            content={reasoning}
            streaming={isStreaming}
            className="text-xs opacity-80"
          />
        </div>
      )}
    </div>
  );
}
