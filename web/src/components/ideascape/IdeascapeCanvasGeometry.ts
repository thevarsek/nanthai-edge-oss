import { TREE_NODE_H, TREE_NODE_W } from "./treeLayout";

export function computeIdeascapeDisplayGeometry(
  logicalPosMap: Map<string, { x: number; y: number }>,
  effectiveSizeMap: Map<string, { width: number; height: number }>,
) {
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
  const offsetX = minX < 0 ? -minX + 180 : 180;
  const offsetY = minY < 0 ? -minY + 80 : 80;
  const posMap = new Map<string, { x: number; y: number }>();

  for (const [id, pos] of logicalPosMap) {
    posMap.set(id, { x: pos.x + offsetX, y: pos.y + offsetY });
  }

  return {
    posMap,
    width: Math.max(1600, maxX + offsetX + 180),
    height: Math.max(1200, maxY + offsetY + 140),
    offsetX,
    offsetY,
  };
}
