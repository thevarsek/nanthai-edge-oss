import {
  Search,
  Globe,
  FileText,
  LinkIcon,
  Loader2,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  SkeletonCircle,
  SkeletonCard,
  IconSlot,
  AccentDot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Search & Research Illustration                                     */
/*  Shows a search query → results panel with source cards and a       */
/*  research progress indicator.                                       */
/* ------------------------------------------------------------------ */

function MockSourceCard({
  width,
  delay,
}: {
  width: string;
  delay: number;
}) {
  return (
    <SkeletonCard className={`edge-stagger-${Math.min(delay, 8)}`}>
      <div className="flex items-start gap-2.5">
        <SkeletonCircle size={20} shade="light">
          <IconSlot icon={Globe} size={10} className="efg-25" />
        </SkeletonCircle>
        <div className="flex-1 min-w-0 space-y-1.5">
          <SkeletonLine width={width} height="sm" shade="medium" />
          <SkeletonLine width="100%" height="xs" shade="light" />
          <SkeletonLine width="70%" height="xs" shade="light" />
        </div>
      </div>
    </SkeletonCard>
  );
}

function MockResearchProgress() {
  const steps = [
    { label: "Planning queries", done: true },
    { label: "Searching 4 sources", done: true },
    { label: "Analyzing results", done: false },
    { label: "Writing report", done: false },
  ];

  return (
    <div className="rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-3 space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <IconSlot icon={FileText} size={12} className="text-[var(--edge-blue)]" />
        <span className="text-[10px] font-semibold efg-40 uppercase tracking-wider">Research Pipeline</span>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          {s.done ? (
            <AccentDot color="var(--edge-cyan)" size={6} />
          ) : i === 2 ? (
            <IconSlot icon={Loader2} size={10} className="text-[var(--edge-amber)] animate-spin" />
          ) : (
            <AccentDot color="rgba(var(--edge-fg),0.15)" size={6} />
          )}
          <span className={`text-[10px] ${s.done ? "efg-50" : "efg-25"}`}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

export function SearchIllustration() {
  return (
    <MockPanel showDots title="Search & Research" className="max-w-lg mx-auto">
      {/* Search input */}
      <div className="flex items-center gap-2 rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)] px-3 py-2.5 mb-4">
        <IconSlot icon={Search} size={14} className="efg-30" />
        <SkeletonLine width="55%" height="sm" shade="medium" />
      </div>

      {/* Tier tabs */}
      <div className="flex gap-2 mb-4">
        {["Quick", "Medium", "Deep Research"].map((t, i) => (
          <div
            key={t}
            className={`rounded-full px-2.5 py-1 text-[9px] font-medium ${
              i === 2
                ? "bg-[var(--edge-blue)] text-white"
                : "bg-[rgba(var(--edge-fg),0.05)] efg-30"
            }`}
          >
            {t}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Source cards */}
        <div className="space-y-2.5">
          <MockSourceCard width="75%" delay={1} />
          <MockSourceCard width="60%" delay={2} />
          <MockSourceCard width="85%" delay={3} />
        </div>

        {/* Research progress + citations */}
        <div className="space-y-2.5">
          <MockResearchProgress />

          <div className="rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.02)] p-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <IconSlot icon={LinkIcon} size={10} className="efg-25" />
              <span className="text-[10px] font-medium efg-35">4 citations</span>
            </div>
            <SkeletonLine width="90%" height="xs" shade="light" />
            <SkeletonLine width="75%" height="xs" shade="light" />
            <SkeletonLine width="85%" height="xs" shade="light" />
          </div>
        </div>
      </div>
    </MockPanel>
  );
}
