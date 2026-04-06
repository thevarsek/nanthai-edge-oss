// components/ideascape/IdeascapeCanvas.tsx
// Infinite 2D canvas: pan, zoom, drag-to-reposition.
// Layout uses tree algorithm from treeLayout.ts; rendering via IdeascapeNodes.tsx.

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { computeTreeLayout, TREE_NODE_W, TREE_NODE_H } from "./treeLayout";
import { MessageNode, Connectors, type NodeVisualState } from "./IdeascapeNodes";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface NodePosition {
  _id: Id<"nodePositions">;
  messageId: Id<"messages">;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasViewport {
  x: number;
  y: number;
  scale: number;
}

interface IdeascapeCanvasProps {
  messages: Message[];
  positions: NodePosition[];
  viewport: CanvasViewport;
  selectedIds: Set<Id<"messages">>;
  focusedId: Id<"messages"> | null;
  activeBranchIds: Set<string>;
  contextBranchIds: Set<string>;
  onViewportChange: (vp: CanvasViewport) => void;
  onNodeDragEnd: (messageId: Id<"messages">, x: number, y: number) => void;
  onNodeResizeEnd: (messageId: Id<"messages">, width: number, height: number) => void;
  onSelectNode: (id: Id<"messages">, multi: boolean) => void;
  onFocusNode: (id: Id<"messages">) => void;
  onClearSelection: () => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;

// ─── Main canvas ────────────────────────────────────────────────────────────

export function IdeascapeCanvas({
  messages, positions, viewport, selectedIds, focusedId, activeBranchIds, contextBranchIds,
  onViewportChange, onNodeDragEnd, onNodeResizeEnd, onSelectNode, onFocusNode, onClearSelection,
}: IdeascapeCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const dragState = useRef<{
    messageId: Id<"messages">; startNodeX: number; startNodeY: number;
    startPointerX: number; startPointerY: number;
    moved: boolean;
  } | null>(null);
  const resizeState = useRef<{
    messageId: Id<"messages">; startWidth: number; startHeight: number;
    startPointerX: number; startPointerY: number;
    moved: boolean;
  } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; width: number; height: number } | null>(null);

  // Build merged position map: stored positions override tree layout.
  // Tree layout is centered around x=0 like iOS, so shift into positive display
  // coordinates for rendering while preserving logical coordinates for persistence.
  const treeMap = useMemo(() => computeTreeLayout(messages), [messages]);
  const logicalPosMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>(treeMap);
    for (const p of positions) {
      map.set(p.messageId as string, { x: p.x, y: p.y });
    }
    return map;
  }, [treeMap, positions]);

  const sizeMap = useMemo(() => {
    const map = new Map<string, { width: number; height: number }>();
    for (const msg of messages) {
      map.set(msg._id as string, { width: TREE_NODE_W, height: TREE_NODE_H });
    }
    for (const p of positions) {
      map.set(p.messageId as string, { width: p.width, height: p.height });
    }
    return map;
  }, [messages, positions]);

  const effectiveSizeMap = useMemo(() => {
    const map = new Map(sizeMap);
    if (resizePreview) map.set(resizePreview.id, { width: resizePreview.width, height: resizePreview.height });
    return map;
  }, [sizeMap, resizePreview]);

  useEffect(() => {
    if (!resizePreview) return;
    const persisted = sizeMap.get(resizePreview.id);
    if (persisted && persisted.width === resizePreview.width && persisted.height === resizePreview.height) {
      const timer = window.setTimeout(() => setResizePreview(null), 0);
      return () => window.clearTimeout(timer);
    }
  }, [sizeMap, resizePreview]);

  const displayGeometry = useMemo(() => {
    const entries = Array.from(logicalPosMap.values());
    if (entries.length === 0) {
      return {
        posMap: new Map<string, { x: number; y: number }>(),
        width: 1600,
        height: 1200,
        offsetX: 240,
        offsetY: 120,
      };
    }

    const minX = Math.min(...Array.from(logicalPosMap.entries()).map(([, p]) => p.x));
    const maxX = Math.max(...Array.from(logicalPosMap.entries()).map(([id, p]) => p.x + (effectiveSizeMap.get(id)?.width ?? TREE_NODE_W)));
    const minY = Math.min(...Array.from(logicalPosMap.entries()).map(([, p]) => p.y));
    const maxY = Math.max(...Array.from(logicalPosMap.entries()).map(([id, p]) => p.y + (effectiveSizeMap.get(id)?.height ?? TREE_NODE_H)));
    const offsetX = minX < 0 ? Math.abs(minX) + 180 : 180;
    const offsetY = minY < 0 ? Math.abs(minY) + 80 : 80;
    const posMap = new Map<string, { x: number; y: number }>();

    for (const [id, pos] of logicalPosMap) {
      posMap.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
    }

    return {
      posMap,
      width: Math.max(1600, maxX - minX + 360),
      height: Math.max(1200, maxY - minY + 220),
      offsetX,
      offsetY,
    };
  }, [logicalPosMap, effectiveSizeMap]);

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-node-scroll]")) {
        return;
      }
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.93;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor));
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const newX = cx - (cx - viewport.x) * (newScale / viewport.scale);
      const newY = cy - (cy - viewport.y) * (newScale / viewport.scale);
      onViewportChange({ x: newX, y: newY, scale: newScale });
    },
    [viewport, onViewportChange],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [handleWheel]);

  // ── Pan ───────────────────────────────────────────────────────────────────

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("[data-node]")) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - viewport.x, y: e.clientY - viewport.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current) {
      const dx = (e.clientX - dragState.current.startPointerX) / viewport.scale;
      const dy = (e.clientY - dragState.current.startPointerY) / viewport.scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        dragState.current.moved = true;
      }
      const nodeEl = containerRef.current?.querySelector(
        `[data-message-id="${dragState.current.messageId}"] [data-node-shell]`,
      ) as HTMLElement | null;
      if (nodeEl) {
        nodeEl.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      return;
    }
    if (resizeState.current) {
      const dx = (e.clientX - resizeState.current.startPointerX) / viewport.scale;
      const dy = (e.clientY - resizeState.current.startPointerY) / viewport.scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        resizeState.current.moved = true;
      }
      setResizePreview({
        id: resizeState.current.messageId as string,
        width: Math.max(180, resizeState.current.startWidth + dx),
        height: Math.max(120, resizeState.current.startHeight + dy),
      });
      return;
    }
    if (!isPanning.current) return;
    onViewportChange({
      x: e.clientX - panStart.current.x,
      y: e.clientY - panStart.current.y,
      scale: viewport.scale,
    });
  };

  const onCanvasPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState.current) {
      const dx = (e.clientX - dragState.current.startPointerX) / viewport.scale;
      const dy = (e.clientY - dragState.current.startPointerY) / viewport.scale;
      if (dragState.current.moved) {
        onNodeDragEnd(
          dragState.current.messageId,
          dragState.current.startNodeX + dx - displayGeometry.offsetX,
          dragState.current.startNodeY + dy - displayGeometry.offsetY,
        );
      }
      const nodeEl = containerRef.current?.querySelector(
        `[data-message-id="${dragState.current.messageId}"] [data-node-shell]`,
      ) as HTMLElement | null;
      if (nodeEl) {
        nodeEl.style.transform = "";
      }
      dragState.current = null;
    }
    if (resizeState.current) {
      const dx = (e.clientX - resizeState.current.startPointerX) / viewport.scale;
      const dy = (e.clientY - resizeState.current.startPointerY) / viewport.scale;
      if (resizeState.current.moved) {
        onNodeResizeEnd(
          resizeState.current.messageId,
          Math.max(180, resizeState.current.startWidth + dx),
          Math.max(120, resizeState.current.startHeight + dy),
        );
      } else {
        setResizePreview(null);
      }
      resizeState.current = null;
    }
    isPanning.current = false;
  };

  // ── Node drag start ───────────────────────────────────────────────────────

  const [, forceRender] = useState(0);

  const onNodePointerDown = useCallback(
    (e: ReactPointerEvent, id: Id<"messages">) => {
      e.stopPropagation();
      const pos = displayGeometry.posMap.get(id as string);
      if (!pos) return;
      dragState.current = {
        messageId: id, startNodeX: pos.x, startNodeY: pos.y,
        startPointerX: e.clientX, startPointerY: e.clientY,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      forceRender((n) => n + 1);
    },
    [displayGeometry.posMap],
  );

  const onNodeResizePointerDown = useCallback(
    (e: ReactPointerEvent, id: Id<"messages">) => {
      e.stopPropagation();
      const size = sizeMap.get(id as string) ?? { width: TREE_NODE_W, height: TREE_NODE_H };
      resizeState.current = {
        messageId: id,
        startWidth: size.width,
        startHeight: size.height,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        moved: false,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      forceRender((n) => n + 1);
    },
    [sizeMap],
  );

  // ── Resolve visual state per node ─────────────────────────────────────────

  const getVisualState = useCallback(
    (id: Id<"messages">): NodeVisualState => {
      if (selectedIds.has(id)) return "selected";
      if (focusedId === id) return "focused";
      if (activeBranchIds.has(id as string)) return "activeBranch";
      return "default";
    },
    [selectedIds, focusedId, activeBranchIds],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-surface-1 cursor-default select-none"
      style={{ touchAction: "none" }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onClick={(e) => {
        if ((e.target as HTMLElement) === containerRef.current) onClearSelection();
      }}
    >
      {/* Dot-grid background */}
      <svg
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        aria-hidden
      >
        <defs>
          <pattern
            id="dots"
            x={viewport.x % (20 * viewport.scale)}
            y={viewport.y % (20 * viewport.scale)}
            width={20 * viewport.scale}
            height={20 * viewport.scale}
            patternUnits="userSpaceOnUse"
          >
            <circle cx={1} cy={1} r={0.8} fill="hsl(var(--nanth-muted) / 0.28)" opacity={0.9} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>

      {/* Canvas layer (translated + scaled) */}
      <div
        style={{
          position: "absolute",
          transformOrigin: "0 0",
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <div style={{ position: "relative", width: displayGeometry.width, height: displayGeometry.height }}>
            <Connectors
              messages={messages}
              posMap={displayGeometry.posMap}
              sizeMap={effectiveSizeMap}
              activeBranchIds={activeBranchIds}
              contextBranchIds={contextBranchIds}
              width={displayGeometry.width}
              height={displayGeometry.height}
            />
        {messages.map((msg) => {
          const pos = displayGeometry.posMap.get(msg._id as string) ?? { x: 0, y: 0 };
          const size = effectiveSizeMap.get(msg._id as string) ?? { width: TREE_NODE_W, height: TREE_NODE_H };
          return (
            <div key={msg._id} data-node data-message-id={msg._id} style={{ position: "relative", zIndex: 1 }}>
              <MessageNode
                message={msg}
                x={pos.x}
                y={pos.y}
                width={size.width}
                height={size.height}
                visualState={getVisualState(msg._id)}
                scale={viewport.scale}
                onPointerDown={onNodePointerDown}
                onResizePointerDown={onNodeResizePointerDown}
                onSelect={onSelectNode}
                onFocus={onFocusNode}
              />
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
}
