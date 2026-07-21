import { BarChart3, Check, Code2, Download, FileSpreadsheet } from "lucide-react";

import { IconSlot, MockPanel, SkeletonLine } from "./IllustrationPrimitives";

const bars = [44, 68, 55, 82, 72];

export function AnalysisCodeIllustration() {
  return (
    <MockPanel showDots title="Analysis workspace" className="mx-auto max-w-xl">
      <div className="flex items-center gap-3 rounded-xl border border-[rgba(var(--edge-fg),0.07)] px-4 py-3">
        <IconSlot icon={FileSpreadsheet} className="text-[var(--edge-amber)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold efg-60">quarterly-results.xlsx</p>
          <p className="mt-0.5 text-[8px] efg-25">Attached from Knowledge Base</p>
        </div>
        <Check size={12} className="text-[var(--edge-cyan)]" />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-[#111827] p-4 text-white">
          <div className="flex items-center gap-2 text-[8px] text-white/45">
            <Code2 size={12} /> Python analysis
          </div>
          <div className="mt-4 space-y-2">
            <SkeletonLine width="88%" height="xs" className="bg-white/20" />
            <SkeletonLine width="70%" height="xs" className="bg-[var(--edge-cyan)]/60" />
            <SkeletonLine width="78%" height="xs" className="bg-white/15" />
            <SkeletonLine width="54%" height="xs" className="bg-[var(--edge-amber)]/55" />
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(var(--edge-fg),0.07)] p-4">
          <div className="flex items-center gap-2 text-[8px] font-medium efg-40">
            <BarChart3 size={12} /> Revenue trend
          </div>
          <div className="mt-4 flex h-16 items-end gap-2 border-b border-[rgba(var(--edge-fg),0.08)] px-1">
            {bars.map((height, index) => (
              <div
                key={height}
                className={index === bars.length - 1 ? "flex-1 rounded-t bg-[var(--edge-coral)]" : "flex-1 rounded-t bg-[rgba(var(--edge-fg),0.10)]"}
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-xl bg-[rgba(var(--edge-fg),0.025)] px-4 py-3">
        <IconSlot icon={Download} size={13} />
        <span className="text-[8px] efg-40">Chart and cleaned data ready to download</span>
      </div>
    </MockPanel>
  );
}
