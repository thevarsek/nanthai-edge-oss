import { useId, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

type Model = { displayName: string; provider: string | null; modelId: string; availability: string; unavailableReason?: string | null };

/** Search and model choice share one keyboard-accessible picker. */
export function RuntimeModelCombobox({ models, selectedIndex, onSelect, autoOpen = false }: {
  models: Model[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  autoOpen?: boolean;
}) {
  const { t } = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(autoOpen);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const results = models.map((model, index) => ({ model, index })).filter(({ model }) =>
    `${model.displayName} ${model.provider ?? ""} ${model.modelId}`.toLowerCase().includes(search.toLowerCase()),
  );
  const activeResult = results[Math.min(active, Math.max(0, results.length - 1))];
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (index: number) => { onSelect(index); close(); };

  return (
    <div className="relative" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
    }}>
      <button ref={trigger} type="button" role="combobox" aria-label={t("persona_runtime_available_models")}
        aria-expanded={open} aria-controls={`${id}-list`} aria-haspopup="listbox"
        onClick={() => { setOpen(!open); setSearch(""); setActive(0); }}
        onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface-1 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
        <span className="min-w-0 truncate">{models[selectedIndex]?.displayName ?? t("persona_runtime_choose_discovered_model")}</span>
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-border bg-surface-1 shadow-lg"
          onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Search size={16} className="shrink-0 text-muted" />
            <input autoFocus type="search" aria-label={t("search_models")} placeholder={t("search_models")}
              value={search} onChange={event => { setSearch(event.target.value); setActive(0); }}
              aria-controls={`${id}-list`} aria-activedescendant={activeResult ? `${id}-${activeResult.index}` : undefined}
              autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onKeyDown={event => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive(Math.max(0, Math.min(results.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
                }
                if (event.key === "Enter" && activeResult?.model.availability === "available") {
                  event.preventDefault(); choose(activeResult.index);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none" />
          </div>
          <div id={`${id}-list`} role="listbox" aria-label={t("persona_runtime_available_models")} className="max-h-64 overflow-y-auto p-1">
            {results.map(({ model, index }) => (
              <button type="button" key={`${model.provider}:${model.modelId}:${index}`} id={`${id}-${index}`} role="option"
                aria-label={[model.displayName, model.provider, model.availability !== "available" ? model.unavailableReason ?? t("persona_runtime_model_unavailable") : null].filter(Boolean).join(" ")}
                aria-selected={index === selectedIndex} disabled={model.availability !== "available"}
                onClick={() => choose(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent hover:bg-surface-3 disabled:opacity-50 ${index === activeResult?.index ? "bg-surface-2" : ""}`}>
                <span className="min-w-0 flex-1 break-words">
                  {model.displayName}
                  <span className="block text-xs text-muted">{model.provider ?? model.modelId}</span>
                  {model.availability !== "available" && <span className="block text-xs text-muted">{model.unavailableReason ?? t("persona_runtime_model_unavailable")}</span>}
                </span>
                {index === selectedIndex && <Check size={16} className="shrink-0 text-accent" />}
              </button>
            ))}
            {!results.length && <p role="status" className="px-3 py-4 text-sm text-muted">{t("no_models_match_your_current_search_or_filters")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
