import type { Message } from "@/hooks/useChat";
import { TREE_NODE_H, TREE_NODE_W } from "./treeLayout";

export function Connectors({
  messages,
  posMap,
  sizeMap,
  activeBranchIds,
  contextBranchIds,
  width,
  height,
}: {
  messages: Message[];
  posMap: Map<string, { x: number; y: number }>;
  sizeMap: Map<string, { width: number; height: number }>;
  activeBranchIds: Set<string>;
  contextBranchIds: Set<string>;
  width: number;
  height: number;
}) {
  const lines: {
    x1: number; y1: number;
    x2: number; y2: number;
    key: string;
    emphasis: "active" | "context" | "default";
  }[] = [];

  for (const message of messages) {
    if (!message.parentMessageIds?.length) continue;
    const childPosition = posMap.get(message._id as string);
    if (!childPosition) continue;
    const childId = message._id as string;

    for (const parentId of message.parentMessageIds) {
      const parentPosition = posMap.get(parentId as string);
      if (!parentPosition) continue;
      const parentSize = sizeMap.get(parentId as string) ?? { width: TREE_NODE_W, height: TREE_NODE_H };
      const childSize = sizeMap.get(childId) ?? { width: TREE_NODE_W, height: TREE_NODE_H };
      const isActive = activeBranchIds.has(childId) && activeBranchIds.has(parentId as string);
      const isContext = contextBranchIds.has(childId) && contextBranchIds.has(parentId as string);
      lines.push({
        x1: parentPosition.x + parentSize.width / 2,
        y1: parentPosition.y + parentSize.height,
        x2: childPosition.x + childSize.width / 2,
        y2: childPosition.y,
        key: `${parentId}-${message._id}`,
        emphasis: isActive ? "active" : isContext ? "context" : "default",
      });
    }
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none", zIndex: 0 }}
    >
      {lines.map((line) => (
        <path
          key={line.key}
          d={`M ${line.x1} ${line.y1} L ${line.x1} ${(line.y1 + line.y2) / 2} L ${line.x2} ${(line.y1 + line.y2) / 2} L ${line.x2} ${line.y2}`}
          fill="none"
          stroke={
            line.emphasis === "active"
              ? "hsl(var(--nanth-primary) / 0.7)"
              : line.emphasis === "context"
                ? "hsl(var(--nanth-primary) / 0.42)"
                : "hsl(var(--nanth-muted) / 0.65)"
          }
          strokeWidth={line.emphasis === "active" ? 1.8 : line.emphasis === "context" ? 1.4 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={1}
        />
      ))}
    </svg>
  );
}
