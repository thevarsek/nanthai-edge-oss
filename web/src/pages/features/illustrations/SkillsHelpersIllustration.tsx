import { Bot, Check, GitMerge, Puzzle, Sparkles } from "lucide-react";

import { IconSlot, MockPanel, SkeletonLine } from "./IllustrationPrimitives";

const helpers = [
  { label: "Research", accent: "var(--edge-cyan)" },
  { label: "Analyse", accent: "var(--edge-blue)" },
  { label: "Review", accent: "var(--edge-amber)" },
];

export function SkillsHelpersIllustration() {
  return (
    <MockPanel showDots title="Specialist workflow" className="mx-auto max-w-xl">
      <div className="grid gap-3 md:grid-cols-[0.8fr_1.35fr]">
        <div className="rounded-xl border border-[rgba(var(--edge-fg),0.07)] p-4">
          <div className="flex items-center gap-2">
            <IconSlot icon={Puzzle} className="text-[var(--edge-amber)]" />
            <span className="text-[10px] font-semibold efg-70">Launch planning skill</span>
          </div>
          <div className="mt-4 space-y-2">
            <SkeletonLine width="92%" />
            <SkeletonLine width="76%" />
            <SkeletonLine width="58%" />
          </div>
          <div className="mt-4 flex items-center gap-1 text-[8px] efg-35">
            <Check size={10} className="text-[var(--edge-cyan)]" />
            Loaded only when needed
          </div>
        </div>

        <div className="rounded-xl bg-[rgba(var(--edge-fg),0.025)] p-3">
          <div className="flex items-center gap-2 text-[9px] font-medium efg-45">
            <IconSlot icon={Sparkles} size={13} />
            Parallel helpers
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {helpers.map((helper) => (
              <div key={helper.label} className="rounded-lg border border-[rgba(var(--edge-fg),0.06)] p-2.5 text-center">
                <Bot size={15} className="mx-auto" style={{ color: helper.accent }} />
                <p className="mt-2 text-[8px] font-semibold efg-55">{helper.label}</p>
                <SkeletonLine width="72%" height="xs" className="mx-auto mt-2" />
              </div>
            ))}
          </div>
          <div className="mx-auto my-2 h-4 w-px bg-[rgba(var(--edge-fg),0.12)]" />
          <div className="flex items-center justify-center gap-2 rounded-lg border border-[rgba(var(--edge-fg),0.07)] px-3 py-2">
            <GitMerge size={13} className="text-[var(--edge-coral)]" />
            <span className="text-[8px] font-medium efg-45">One combined response</span>
          </div>
        </div>
      </div>
    </MockPanel>
  );
}
