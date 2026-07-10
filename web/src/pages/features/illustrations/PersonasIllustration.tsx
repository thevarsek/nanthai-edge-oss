import { Check, Globe2, LockKeyhole, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MockPanel } from "./IllustrationPrimitives";

function PersonaChip({ emoji, name, active, online }: {
  emoji: string;
  name: string;
  active?: boolean;
  online?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full border px-2 py-1 ${active ? "border-[var(--edge-coral)]/35 bg-[var(--edge-coral)]/8" : "border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.025)]"}`}>
      <span className="text-[11px]">{emoji}</span>
      <span className="text-[9px] font-semibold efg-55">{name}</span>
      {online && <Globe2 size={8} className="text-[var(--edge-cyan)]" />}
      {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--edge-coral)]" />}
    </div>
  );
}

export function PersonasIllustration() {
  const { t } = useTranslation();
  return (
    <MockPanel showDots title={t("advisors")} className="mx-auto max-w-sm">
      <div className="rounded-xl border border-[rgba(var(--edge-fg),0.07)] bg-[rgba(var(--edge-fg),0.02)] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] efg-35">
            <LockKeyhole size={10} />
            {t("private_advice")}
          </div>
          <span className="text-[8px] efg-25">2 / 3</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <PersonaChip emoji="🧑‍💻" name="Code Reviewer" active />
          <PersonaChip emoji="📊" name="Data Analyst" online />
          <PersonaChip emoji="🛡️" name="Risk Lead" />
        </div>
        <div className="mt-3 space-y-1.5 rounded-lg bg-[rgba(var(--edge-fg),0.025)] p-2.5">
          <div className="h-1.5 w-[86%] animate-pulse rounded-full bg-[rgba(var(--edge-fg),0.10)]" />
          <div className="h-1.5 w-[68%] animate-pulse rounded-full bg-[rgba(var(--edge-fg),0.07)]" />
          <div className="h-1.5 w-[76%] rounded-full bg-[rgba(var(--edge-fg),0.05)]" />
        </div>
      </div>

      <div className="mx-auto h-4 w-px bg-[rgba(var(--edge-fg),0.10)]" />

      <div className="rounded-xl border border-[var(--edge-cyan)]/20 bg-[var(--edge-cyan)]/5 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--edge-cyan)]/12">
            <Sparkles size={12} className="text-[var(--edge-cyan)]" />
          </span>
          <div>
            <p className="text-[10px] font-semibold efg-65">{t("advisor_synthesizing")}</p>
            <p className="text-[8px] efg-25">{t("advisor_responded_count", { completed: 3, total: 3 })}</p>
          </div>
          <Check size={12} className="ml-auto text-[var(--edge-cyan)]" />
        </div>
        <div className="space-y-1.5">
          <div className="h-1.5 w-full rounded-full bg-[rgba(var(--edge-fg),0.10)]" />
          <div className="h-1.5 w-[88%] rounded-full bg-[rgba(var(--edge-fg),0.07)]" />
        </div>
      </div>
    </MockPanel>
  );
}
