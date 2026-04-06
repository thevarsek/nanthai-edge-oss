import {
  Brain,
  Search,
  Eye,
  Pin,
  Clock,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  IconSlot,
  AccentDot,
  SkeletonDivider,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Memories Illustration                                              */
/*  Shows categorised memory entries, retrieval mode badges,          */
/*  a pending review item, and a pinned memory.                       */
/* ------------------------------------------------------------------ */

function RetrievalBadge({ mode }: { mode: "always-on" | "contextual" }) {
  const isAlways = mode === "always-on";
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wide ${
        isAlways
          ? "bg-[rgba(var(--edge-cyan-rgb,20,184,166),0.12)] text-[var(--edge-cyan)]"
          : "bg-[rgba(var(--edge-fg),0.06)] efg-30"
      }`}
    >
      {isAlways ? "Always On" : "Contextual"}
    </span>
  );
}

function MockMemoryEntry({
  category,
  categoryColor,
  content,
  mode,
  pinned,
  pending,
}: {
  category: string;
  categoryColor: string;
  content: string;
  mode: "always-on" | "contextual";
  pinned?: boolean;
  pending?: boolean;
}) {
  return (
    <div
      className={`flex items-start gap-2.5 py-2.5 ${
        pending ? "opacity-60" : ""
      }`}
    >
      <AccentDot color={categoryColor} size={7} className="mt-1.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1 flex-wrap">
          <span
            className="rounded-full px-2 py-0.5 text-[7px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: `${categoryColor}15`, color: categoryColor }}
          >
            {category}
          </span>
          <RetrievalBadge mode={mode} />
          {pending && (
            <span className="rounded-full px-1.5 py-0.5 text-[7px] font-semibold uppercase tracking-wide bg-[rgba(var(--edge-amber-rgb,251,191,36),0.12)] text-[var(--edge-amber)]">
              Pending
            </span>
          )}
        </div>
        <p className="text-[10px] efg-45 leading-relaxed">{content}</p>
      </div>
      <div className="flex flex-col items-center gap-1 mt-0.5 shrink-0">
        {pinned && <IconSlot icon={Pin} size={9} className="text-[var(--edge-cyan)]" />}
        <IconSlot icon={Eye} size={10} className="efg-15" />
      </div>
    </div>
  );
}

export function MemoriesIllustration() {
  return (
    <MockPanel showDots title="Memories" className="max-w-sm mx-auto">
      {/* Search */}
      <div className="flex items-center gap-2 rounded-lg border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)] px-2.5 py-2 mb-3">
        <IconSlot icon={Search} size={12} className="efg-25" />
        <SkeletonLine width="40%" height="xs" shade="light" />
      </div>

      {/* Category tabs — showing actual category names */}
      <div className="flex gap-1.5 mb-3 overflow-x-auto">
        {[
          { label: "All", active: true },
          { label: "Preferences", active: false },
          { label: "Work", active: false },
          { label: "Writing Style", active: false },
          { label: "Goals", active: false },
        ].map((tab, i) => (
          <div
            key={i}
            className={`rounded-full px-2.5 py-1 text-[9px] font-medium shrink-0 ${
              tab.active
                ? "bg-[var(--edge-cyan)] text-white"
                : "bg-[rgba(var(--edge-fg),0.05)] efg-30"
            }`}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {/* Memory entries */}
      <div className="rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] px-3">
        <MockMemoryEntry
          category="Preferences"
          categoryColor="var(--edge-cyan)"
          content="Prefers concise bullet-point answers over long paragraphs."
          mode="always-on"
          pinned
        />
        <SkeletonDivider />
        <MockMemoryEntry
          category="Work"
          categoryColor="var(--edge-coral)"
          content="Currently building a multi-model AI chat app using Convex."
          mode="contextual"
        />
        <SkeletonDivider />
        <MockMemoryEntry
          category="Writing Style"
          categoryColor="var(--edge-amber)"
          content="Writing style is direct and avoids unnecessary filler."
          mode="contextual"
          pending
        />
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between mt-3 px-1">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <IconSlot icon={Brain} size={12} className="efg-25" />
            <span className="text-[9px] efg-30">23 saved</span>
          </div>
          <div className="flex items-center gap-1.5">
            <IconSlot icon={Clock} size={11} className="efg-20" />
            <span className="text-[9px] efg-25">1 pending review</span>
          </div>
        </div>
        <span className="text-[8px] efg-20">Pro</span>
      </div>
    </MockPanel>
  );
}
