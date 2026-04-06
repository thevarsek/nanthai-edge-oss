import {
  Copy,
  RotateCcw,
  GitBranch,
  Volume2,
  Users,
  Plus,
  Send,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  SkeletonCircle,
  SkeletonDivider,
  MockProviderAvatar,
  IconSlot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Multi-Model Chat Illustration                                      */
/*  Shows the core UI: user bubble → vertically stacked group card     */
/*  with 3 model responses, branch pill, chat input.                   */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Multi-Model Chat Illustration                                      */
/*  Shows the core UI: user bubble → vertically stacked group card     */
/*  with 3 model responses, favorites strip, branch pill, chat input.  */
/* ------------------------------------------------------------------ */

/* ── Action bar row (copy · retry · fork · listen) ───────────────── */

function MockActionBar() {
  return (
    <div className="flex items-center gap-3 mt-2 ml-9">
      <IconSlot icon={Copy} size={12} className="efg-20 hover:efg-40 transition-colors" />
      <IconSlot icon={RotateCcw} size={12} className="efg-20" />
      <IconSlot icon={GitBranch} size={12} className="efg-20" />
      <IconSlot icon={Volume2} size={12} className="efg-20" />
    </div>
  );
}

/* ── Single response row inside the group card ───────────────────── */

function MockResponse({
  label,
  color,
  lines,
  widths,
}: {
  label: string;
  color: string;
  lines: number;
  widths: string[];
}) {
  return (
    <div className="flex items-start gap-2.5 px-2 py-2">
      <MockProviderAvatar label={label} color={color} size={28} />
      <div className="flex-1 min-w-0">
        {/* Model name */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <SkeletonLine width="60px" height="xs" shade="medium" />
        </div>
        {/* Response skeleton lines */}
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: lines }).map((_, i) => (
            <SkeletonLine
              key={i}
              width={widths[i % widths.length]}
              height="sm"
              shade="light"
            />
          ))}
        </div>
        <MockActionBar />
      </div>
    </div>
  );
}

/* ── User message bubble ─────────────────────────────────────────── */

function MockUserBubble() {
  return (
    <div className="flex justify-end mb-4">
      <div className="rounded-xl px-4 py-2.5 bg-[var(--edge-coral)] max-w-[70%]">
        <SkeletonLine width="90%" height="sm" className="bg-white/20" />
        <SkeletonLine width="55%" height="sm" className="bg-white/20 mt-1.5" />
      </div>
    </div>
  );
}

/* ── Branch indicator pill ───────────────────────────────────────── */

function MockBranchPill() {
  return (
    <div className="flex justify-center my-3">
      <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.03)] px-3 py-1">
        <IconSlot icon={ChevronLeft} size={10} className="efg-25" />
        <span className="text-[10px] font-medium efg-35">Branch 1 of 3</span>
        <IconSlot icon={ChevronRight} size={10} className="efg-25" />
      </div>
    </div>
  );
}

/* ── Chat input bar ──────────────────────────────────────────────── */

function MockChatInput() {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5 border-t border-[rgba(var(--edge-fg),0.06)]">
      <SkeletonCircle size={30} shade="light">
        <IconSlot icon={Plus} size={14} className="efg-30" />
      </SkeletonCircle>
      <div className="flex-1 rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.02)] px-3 py-2">
        <SkeletonLine width="45%" height="sm" shade="light" />
      </div>
      <SkeletonCircle size={30} shade="accent">
        <IconSlot icon={Send} size={13} className="text-white" />
      </SkeletonCircle>
    </div>
  );
}

/* ── Main export ─────────────────────────────────────────────────── */

export function MultiModelChatIllustration() {
  return (
    <MockPanel showDots title="Multi-Model Chat" className="max-w-lg mx-auto">
      <div className="px-2 py-4 space-y-3">
        {/* User message */}
        <MockUserBubble />

        {/* Multi-model group header */}
        <div className="flex items-center gap-1.5 pl-1">
          <IconSlot icon={Users} size={11} className="efg-25" />
          <span className="text-[10px] font-medium efg-30">3 responses</span>
        </div>

        {/* Grouped card with vertically stacked responses */}
        <div className="rounded-xl bg-[rgba(var(--edge-fg),0.02)] border border-[rgba(var(--edge-fg),0.08)] py-1">
          <MockResponse
            label="G"
            color="var(--edge-cyan)"
            lines={3}
            widths={["90%", "100%", "60%"]}
          />

          <SkeletonDivider className="ml-11 mr-2" />

          <MockResponse
            label="C"
            color="var(--edge-coral)"
            lines={3}
            widths={["85%", "95%", "70%"]}
          />

          <SkeletonDivider className="ml-11 mr-2" />

          <MockResponse
            label="M"
            color="var(--edge-amber)"
            lines={2}
            widths={["100%", "45%"]}
          />

          {/* Streaming indicator on last response */}
          <div className="flex items-center gap-1 ml-[44px] mb-2">
            <IconSlot icon={Sparkles} size={10} className="text-[var(--edge-amber)] edge-shimmer" />
            <SkeletonLine width="32px" height="xs" shade="light" shimmer />
          </div>
        </div>

        {/* Branch indicator */}
        <MockBranchPill />
      </div>

      {/* Chat input */}
      <MockChatInput />
    </MockPanel>
  );
}
