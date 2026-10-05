import { useState } from "react";
import { Quote } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Message } from "@/hooks/useChat";

type Citation = NonNullable<Message["sourceCitations"]>[number];
export function SourceEvidencePills({ sourceCitations: citations = [], offlineResult }: Pick<Message, "sourceCitations" | "offlineResult">) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Citation | null>(null);
  return <>
    {offlineResult && <p className="mt-2 text-xs text-muted">{t(offlineResult.disposition === "review" ? "local_result_separate" : "local_result_synced")}</p>}
    {!!citations.length && <div className="mt-2 flex flex-wrap gap-2">
      {citations.map(citation => <button key={`${citation.sourceId}-${citation.quote}`} type="button"
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-surface-2"
        onClick={() => setSelected(citation)}>
        <Quote size={12} /><span className="truncate">{citation.kind === "message" ? t("source_earlier_message") : citation.kind === "memory" ? t("source_shared_memory") : citation.label}</span>
      </button>)}
    </div>}
    {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
      <div role="dialog" aria-modal="true" aria-label={t("source_quote")} className="w-full max-w-md rounded-xl border border-border bg-background p-4 text-foreground shadow-lg">
        <h3 className="font-semibold">{t("source_quote")}</h3>
        {selected.claim && <p className="my-3 text-sm font-medium">{selected.claim}</p>}
        <blockquote className="my-3 max-h-[55vh] overflow-y-auto rounded-lg bg-surface-2 p-4 text-sm whitespace-pre-wrap">{selected.quote}</blockquote>
        <button type="button" autoFocus onClick={() => setSelected(null)} onKeyDown={event => { if (event.key === "Escape") setSelected(null); }} className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white">{t("done")}</button>
      </div>
    </div>}
  </>;
}
