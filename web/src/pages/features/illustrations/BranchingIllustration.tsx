import { GitBranch, ArrowRightLeft } from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  SkeletonCircle,
  MockProviderAvatar,
  IconSlot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Branching Illustration                                             */
/*  Shows a message tree with a fork point and two branches, plus a   */
/*  branch indicator pill between messages.                            */
/* ------------------------------------------------------------------ */

function BranchNode({
  label,
  color,
  lines,
  active,
  className,
}: {
  label: string;
  color: string;
  lines: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${
        active
          ? "border-[var(--edge-cyan)] bg-[rgba(var(--edge-fg),0.05)]"
          : "border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.03)]"
      } ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <MockProviderAvatar label={label} color={color} size={18} />
        <SkeletonLine width="45px" height="xs" shade="medium" />
      </div>
      <div className="space-y-1">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={i === lines - 1 ? "55%" : "85%"}
            height="xs"
            shade="light"
          />
        ))}
      </div>
    </div>
  );
}

function BranchPill({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center py-1">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-[rgba(var(--edge-fg),0.1)] bg-[rgba(var(--edge-fg),0.03)] px-2.5 py-1">
        <IconSlot icon={GitBranch} size={10} className="efg-30" />
        <span className="text-[9px] font-medium efg-40">
          Branch {current} of {total}
        </span>
        <IconSlot icon={ArrowRightLeft} size={9} className="efg-25" />
      </div>
    </div>
  );
}

export function BranchingIllustration() {
  return (
    <MockPanel showDots title="Chat" className="max-w-sm mx-auto">
      {/* User prompt */}
      <div className="flex gap-2 mb-2">
        <SkeletonCircle size={22} shade="light">
          <span className="text-[8px] font-bold efg-30">U</span>
        </SkeletonCircle>
        <div className="flex-1 space-y-1 pt-1">
          <SkeletonLine width="80%" height="xs" shade="medium" />
          <SkeletonLine width="50%" height="xs" shade="light" />
        </div>
      </div>

      {/* AI response (branch 1 — active) */}
      <BranchNode label="G" color="var(--edge-cyan)" lines={2} active />

      {/* Branch indicator pill */}
      <BranchPill current={1} total={3} />

      {/* Fork visualisation — two branch previews side by side */}
      <div className="grid grid-cols-2 gap-2 mb-2">
        <BranchNode label="C" color="var(--edge-coral)" lines={2} />
        <BranchNode label="M" color="var(--edge-amber)" lines={2} />
      </div>

      {/* Divider */}
      <div className="border-t border-[rgba(var(--edge-fg),0.06)] my-2" />

      {/* Follow-up on active branch */}
      <div className="flex gap-2">
        <SkeletonCircle size={22} shade="light">
          <span className="text-[8px] font-bold efg-30">U</span>
        </SkeletonCircle>
        <div className="flex-1 space-y-1 pt-1">
          <SkeletonLine width="65%" height="xs" shade="medium" />
        </div>
      </div>
    </MockPanel>
  );
}
