import { Network } from "lucide-react";
import { IconSlot, MockPanel } from "./IllustrationPrimitives";

interface GraphNode {
  x: number;
  y: number;
  r: number;
  color: string;
  halo?: boolean;
}

const nodes: GraphNode[] = [
  { x: 160, y: 103, r: 7, color: "var(--edge-cyan)", halo: true },
  { x: 99, y: 66, r: 5, color: "var(--edge-blue)" },
  { x: 225, y: 64, r: 5, color: "var(--edge-coral)" },
  { x: 222, y: 145, r: 5, color: "var(--edge-amber)" },
  { x: 93, y: 145, r: 5, color: "var(--edge-lilac)" },
  { x: 49, y: 49, r: 2.5, color: "var(--edge-blue)" },
  { x: 68, y: 94, r: 3, color: "var(--edge-blue)" },
  { x: 112, y: 26, r: 2.5, color: "var(--edge-cyan)" },
  { x: 164, y: 35, r: 3, color: "var(--edge-cyan)" },
  { x: 251, y: 29, r: 2.5, color: "var(--edge-coral)" },
  { x: 274, y: 79, r: 3, color: "var(--edge-coral)" },
  { x: 274, y: 137, r: 2.5, color: "var(--edge-amber)" },
  { x: 248, y: 180, r: 3, color: "var(--edge-amber)" },
  { x: 173, y: 177, r: 2.5, color: "var(--edge-cyan)" },
  { x: 117, y: 188, r: 3, color: "var(--edge-lilac)" },
  { x: 45, y: 165, r: 2.5, color: "var(--edge-lilac)" },
];

const edges = [
  [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 4], [2, 3], [3, 4],
  [1, 5], [1, 6], [1, 7], [1, 8], [2, 8], [2, 9], [2, 10],
  [3, 11], [3, 12], [3, 13], [4, 13], [4, 14], [4, 15],
] as const;

function RelationshipMap() {
  return (
    <div
      className="relative overflow-hidden rounded-xl border border-[rgba(var(--edge-fg),0.07)] bg-[rgba(var(--edge-fg),0.015)]"
      role="img"
      aria-label="Stylised graph of connected memories"
    >
      <div className="absolute inset-x-0 top-0 h-24 bg-[radial-gradient(circle_at_50%_0%,rgba(var(--edge-cyan-rgb),0.07),transparent_72%)]" />
      <svg className="relative h-56 w-full" viewBox="0 0 320 210">
        {edges.map(([from, to]) => (
          <line
            key={`${from}-${to}`}
            x1={nodes[from].x}
            y1={nodes[from].y}
            x2={nodes[to].x}
            y2={nodes[to].y}
            stroke="rgba(var(--edge-fg),0.10)"
            strokeWidth="1"
          />
        ))}
        {nodes.map((node, index) => (
          <g key={index}>
            {node.halo ? (
              <circle
                cx={node.x}
                cy={node.y}
                r={17}
                fill={node.color}
                fillOpacity={0.08}
              />
            ) : null}
            <circle
              cx={node.x}
              cy={node.y}
              r={node.r}
              fill={node.color}
              fillOpacity={node.r >= 5 ? 0.22 : 0.6}
              stroke={node.color}
              strokeWidth={node.r >= 5 ? 1.5 : 0}
            />
          </g>
        ))}
      </svg>
    </div>
  );
}

export function MemoriesIllustration() {
  return (
    <MockPanel showDots title="Memory map" className="mx-auto max-w-sm">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] efg-35">
          <IconSlot icon={Network} size={10} />
          Relationships
        </div>
        <span className="rounded-full bg-[rgba(var(--edge-fg),0.04)] px-2 py-1 text-[8px] efg-25">
          23 memories
        </span>
      </div>

      <RelationshipMap />

      <div className="mt-3 flex items-center justify-center gap-4 text-[8px] efg-25">
        <span className="flex items-center gap-1.5">
          <i className="h-1.5 w-1.5 rounded-full bg-[var(--edge-blue)]" />
          Preferences
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-1.5 w-1.5 rounded-full bg-[var(--edge-coral)]" />
          Context
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-1.5 w-1.5 rounded-full bg-[var(--edge-amber)]" />
          Goals
        </span>
      </div>
    </MockPanel>
  );
}
