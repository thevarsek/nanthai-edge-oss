import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import { useTranslation } from "react-i18next";
import {
  layoutMemoryGraph,
  MEMORY_GRAPH_HEIGHT,
  MEMORY_GRAPH_WIDTH,
} from "./MemoryGraphLayout";
import type { MemoryGraphEdge, MemoryGraphNode } from "./MemoryGraphExplorer";

const CATEGORY_COLORS: Record<string, string> = {
  identity: "#a78bfa",
  preferences: "#5eead4",
  work: "#60a5fa",
  goals: "#fbbf24",
  background: "#c4b5fd",
  writingStyle: "#fb7185",
  relationships: "#f9a8d4",
  skills: "#4ade80",
  tools: "#22d3ee",
  logistics: "#a3e635",
};

interface Transform {
  x: number;
  y: number;
  scale: number;
}

export function MemoryGraphCanvas({
  nodes,
  edges,
  selectedId,
  onSelect,
}: {
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
  selectedId: Id<"memories"> | null;
  onSelect: (id: Id<"memories">) => void;
}) {
  const { t } = useTranslation();
  const [hoveredId, setHoveredId] = useState<Id<"memories"> | null>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const prefersReducedMotion = usePrefersReducedMotion();
  const dragRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const positioned = useMemo(() => layoutMemoryGraph(nodes, edges), [nodes, edges]);
  const byId = useMemo(() => new Map(positioned.map((node) => [node.id, node])), [positioned]);
  const selectedNeighbors = useMemo(() => {
    const ids = new Set<Id<"memories">>();
    if (!selectedId) return ids;
    ids.add(selectedId);
    for (const edge of edges) {
      if (edge.sourceId === selectedId) ids.add(edge.targetId);
      if (edge.targetId === selectedId) ids.add(edge.sourceId);
    }
    return ids;
  }, [edges, selectedId]);

  const zoom = (nextScale: number) => {
    setTransform((current) => ({
      ...current,
      scale: Math.max(0.55, Math.min(3.5, nextScale)),
    }));
  };

  return (
    <div className="relative h-[62vh] min-h-[440px] overflow-hidden rounded-2xl border border-border/50 bg-[#111315]">
      <svg
        className="h-full w-full touch-none"
        viewBox={`0 0 ${MEMORY_GRAPH_WIDTH} ${MEMORY_GRAPH_HEIGHT}`}
        role="application"
        aria-label={t("memory_graph_aria_label", { defaultValue: "Memory relationship graph" })}
        onWheel={(event) => {
          event.preventDefault();
          zoom(transform.scale * (event.deltaY > 0 ? 0.9 : 1.1));
        }}
        onPointerDown={(event) => {
          if ((event.target as SVGElement).closest("[data-memory-node]")) return;
          dragRef.current = {
            x: event.clientX,
            y: event.clientY,
            originX: transform.x,
            originY: transform.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag) return;
          const scaleX = MEMORY_GRAPH_WIDTH / event.currentTarget.clientWidth;
          const scaleY = MEMORY_GRAPH_HEIGHT / event.currentTarget.clientHeight;
          setTransform((current) => ({
            ...current,
            x: drag.originX + (event.clientX - drag.x) * scaleX,
            y: drag.originY + (event.clientY - drag.y) * scaleY,
          }));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
      >
        <defs>
          <marker id="supersedes-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>
        <g transform={`translate(${transform.x} ${transform.y}) scale(${transform.scale})`}>
          <g>
            {!prefersReducedMotion && (
              <animateTransform
                attributeName="transform"
                type="translate"
                values="0 0; 24 -15; -18 20; 0 0"
                dur="18s"
                repeatCount="indefinite"
              />
            )}
            {edges.map((edge) => {
            const source = byId.get(edge.sourceId);
            const target = byId.get(edge.targetId);
            if (!source || !target) return null;
            const emphasized = selectedId === edge.sourceId || selectedId === edge.targetId;
            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={edge.kind === "sameTopic" ? "#818cf8" : "#94a3b8"}
                strokeWidth={emphasized ? 1.5 : 0.65}
                strokeOpacity={selectedId ? (emphasized ? 0.68 : 0.05) : 0.18 + edge.confidence * 0.14}
                strokeDasharray={edge.kind === "supersedes" ? "5 4" : undefined}
                markerEnd={edge.kind === "supersedes" ? "url(#supersedes-arrow)" : undefined}
              />
            );
            })}
            {positioned.map((node) => {
            const active = selectedId === node.id || hoveredId === node.id;
            const muted = selectedId !== null && !selectedNeighbors.has(node.id);
            const color = CATEGORY_COLORS[node.category] ?? "#cbd5e1";
            const motion = nodeMotion(node.id);
            return (
              <g
                key={node.id}
                data-memory-node
                role="button"
                tabIndex={0}
                aria-label={nodes.find((candidate) => candidate.id === node.id)?.content}
                transform={`translate(${node.x} ${node.y})`}
                className="cursor-pointer outline-none"
                opacity={node.isSuperseded ? 0.35 : muted ? 0.22 : 1}
                onClick={() => onSelect(node.id)}
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(node.id)}
                onBlur={() => setHoveredId(null)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(node.id);
                }}
              >
                {!prefersReducedMotion && (
                  <animateTransform
                    attributeName="transform"
                    type="translate"
                    values={[
                      `${node.x} ${node.y}`,
                      `${node.x + motion.x} ${node.y + motion.y}`,
                      `${node.x - motion.x * 0.65} ${node.y - motion.y * 0.65}`,
                      `${node.x} ${node.y}`,
                    ].join("; ")}
                    dur={`${motion.duration}s`}
                    begin={`${motion.delay}s`}
                    repeatCount="indefinite"
                  />
                )}
                <circle
                  r={node.radius + (active ? 4 : 0)}
                  fill={color}
                  fillOpacity={active ? 0.28 : 0.1}
                  stroke={color}
                  strokeWidth={active ? 2.2 : node.retrievalMode === "alwaysOn" ? 1.7 : 0.9}
                />
                <circle r={Math.max(2.2, node.radius * 0.58)} fill={color} />
                {active && (
                  <g transform={`translate(${node.radius + 9} ${-node.radius - 8})`}>
                    <rect x="-6" y="-17" width="210" height="34" rx="7" fill="#202328" stroke="#3a3f47" />
                    <text x="5" y="5" fill="#f3f4f6" fontSize="12">
                      {truncate(nodes.find((candidate) => candidate.id === node.id)?.content ?? "", 29)}
                    </text>
                  </g>
                )}
              </g>
            );
            })}
          </g>
        </g>
      </svg>
      <div className="absolute bottom-3 left-3 flex overflow-hidden rounded-lg border border-border/60 bg-surface-1/90 shadow-lg">
        <button type="button" className="p-2.5 text-muted hover:text-foreground" onClick={() => zoom(transform.scale / 1.2)} aria-label={t("memory_graph_zoom_out", { defaultValue: "Zoom out" })}>
          <Minus size={15} />
        </button>
        <button type="button" className="border-x border-border/60 p-2.5 text-muted hover:text-foreground" onClick={() => zoom(transform.scale * 1.2)} aria-label={t("memory_graph_zoom_in", { defaultValue: "Zoom in" })}>
          <Plus size={15} />
        </button>
        <button type="button" className="flex items-center gap-1.5 p-2.5 text-xs text-muted hover:text-foreground" onClick={() => setTransform({ x: 0, y: 0, scale: 1 })}>
          <Maximize2 size={14} />
          {t("memory_graph_fit_all", { defaultValue: "Fit all" })}
        </button>
      </div>
    </div>
  );
}

function nodeMotion(id: string): { x: number; y: number; duration: number; delay: number } {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const normalizedHash = hash >>> 0;
  const horizontalDirection = (normalizedHash & 1) === 0 ? 1 : -1;
  const verticalDirection = (normalizedHash & 2) === 0 ? 1 : -1;
  return {
    x: horizontalDirection * (14 + (normalizedHash % 9)),
    y: verticalDirection * (11 + ((normalizedHash >>> 4) % 9)),
    duration: 18 + ((normalizedHash >>> 8) % 7),
    delay: -((normalizedHash >>> 16) % 20),
  };
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
