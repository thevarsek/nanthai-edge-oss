import {
  Move,
  ZoomIn,
  MousePointer2,
} from "lucide-react";
import {
  MockPanel,
  SkeletonLine,
  SkeletonCircle,
  MockProviderAvatar,
  IconSlot,
} from "./IllustrationPrimitives";

/* ------------------------------------------------------------------ */
/*  Ideascapes Illustration                                            */
/*  Shows a spatial canvas with floating idea nodes connected by lines */
/* ------------------------------------------------------------------ */

function IdeaNode({
  left,
  y,
  label,
  color,
  lines,
  widthPercent,
}: {
  left: number;
  y: number;
  label: string;
  color: string;
  lines: number;
  widthPercent: number;
}) {
  return (
    <div
      className="absolute rounded-xl border border-[rgba(var(--edge-fg),0.08)] bg-[rgba(var(--edge-fg),0.04)] p-3 backdrop-blur-sm"
      style={{ left: `${left}%`, top: y, width: `${widthPercent}%`, maxWidth: 140 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <MockProviderAvatar label={label} color={color} size={20} />
        <SkeletonLine width="50px" height="xs" shade="medium" />
      </div>
      <div className="space-y-1.5">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={i === lines - 1 ? "60%" : "90%"}
            height="xs"
            shade="light"
          />
        ))}
      </div>
    </div>
  );
}

export function IdeascapesIllustration() {
  return (
    <MockPanel showDots title="Ideascape" className="max-w-lg mx-auto">
      {/* Canvas toolbar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <SkeletonCircle size={26} shade="light">
            <IconSlot icon={MousePointer2} size={12} className="efg-30" />
          </SkeletonCircle>
          <SkeletonCircle size={26} shade="light">
            <IconSlot icon={Move} size={12} className="efg-30" />
          </SkeletonCircle>
          <SkeletonCircle size={26} shade="light">
            <IconSlot icon={ZoomIn} size={12} className="efg-30" />
          </SkeletonCircle>
        </div>
        <div className="text-[9px] font-medium efg-25">
          3 nodes · 2 connections
        </div>
      </div>

      {/* Canvas area with nodes */}
      <div className="relative rounded-xl border border-[rgba(var(--edge-fg),0.06)] bg-[rgba(var(--edge-fg),0.01)] overflow-hidden" style={{ height: 260 }}>
        {/* Connection lines (SVG) */}
        <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }}>
          <line
            x1="34%" y1="50" x2="61%" y2="120"
            stroke="rgba(var(--edge-fg),0.08)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <line
            x1="38%" y1="50" x2="24%" y2="170"
            stroke="rgba(var(--edge-fg),0.08)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
        </svg>

        {/* Idea nodes */}
        <IdeaNode left={8} y={15} label="G" color="var(--edge-cyan)" lines={2} widthPercent={42} />
        <IdeaNode left={50} y={85} label="C" color="var(--edge-coral)" lines={3} widthPercent={42} />
        <IdeaNode left={6} y={145} label="M" color="var(--edge-amber)" lines={2} widthPercent={42} />

        {/* Zoom indicator */}
        <div className="absolute bottom-2 right-2 rounded-full bg-[rgba(var(--edge-fg),0.05)] px-2 py-0.5">
          <span className="text-[8px] font-medium efg-25">75%</span>
        </div>
      </div>
    </MockPanel>
  );
}
