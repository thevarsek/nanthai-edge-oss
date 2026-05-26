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
import { computeIdeascapeDisplayGeometry } from "./IdeascapeCanvasGeometry";

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
  const panPointerStart = useRef({ x: 0, y: 0 });
  const panMoved = useRef(false);
  const dragState = useRef<{
    messageId: Id<"messages">; startNodeX: number; startNodeY: number;
    startPointerX: number; startPointerY: number;
    moved: boolean;
  } | null>(null);
  const suppressNextNodeClickId = useRef<Id<"messages"> | null>(null);
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
    return computeIdeascapeDisplayGeometry(logicalPosMap, effectiveSizeMap);
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
    panMoved.current = false;
    panStart.current = { x: e.clientX - viewport.x, y: e.clientY - viewport.y };
    panPointerStart.current = { x: e.clientX, y: e.clientY };
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
    const movedX = Math.abs(e.clientX - panPointerStart.current.x);
    const movedY = Math.abs(e.clientY - panPointerStart.current.y);
    if (movedX > 2 || movedY > 2) {
      panMoved.current = true;
    }
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
        suppressNextNodeClickId.current = dragState.current.messageId;
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

  const cancelPointerInteraction = useCallback(() => {
    if (dragState.current) {
      const nodeEl = containerRef.current?.querySelector(
        `[data-message-id="${dragState.current.messageId}"] [data-node-shell]`,
      ) as HTMLElement | null;
      if (nodeEl) {
        nodeEl.style.transform = "";
      }
      dragState.current = null;
    }
    if (resizeState.current) {
      resizeState.current = null;
      setResizePreview(null);
    }
    isPanning.current = false;
    panMoved.current = false;
  }, []);

  const handleLostPointerCapture = useCallback(() => {
    if (dragState.current || resizeState.current || isPanning.current) {
      cancelPointerInteraction();
    }
  }, [cancelPointerInteraction]);

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
  const shouldSuppressNodeClick = useCallback((id: Id<"messages">) => {
    if (suppressNextNodeClickId.current !== id) return false;
    suppressNextNodeClickId.current = null;
    return true;
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-surface-1 cursor-default select-none"
      style={{ touchAction: "none" }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={cancelPointerInteraction}
      onLostPointerCapture={handleLostPointerCapture}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("[data-node]") && !panMoved.current) {
          onClearSelection();
        }
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
                onPointerDown={onNodePointerDown}
                onResizePointerDown={onNodeResizePointerDown}
                shouldSuppressClick={shouldSuppressNodeClick}
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
